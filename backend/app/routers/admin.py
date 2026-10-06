"""관리자 전용 수강생 코드 관리 API. 요청마다 X-Admin-Token 헤더로 확인한다."""
import hmac
import re

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app import student_requests, student_store
from app.config import get_settings

router = APIRouter(prefix="/api/admin/students", tags=["admin"])


def _require_admin(token: str | None) -> None:
    expected = get_settings().admin_token
    if not expected:
        raise HTTPException(503, "관리자 토큰(ADMIN_TOKEN)이 서버에 설정되지 않았습니다.")
    if not token or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(401, "관리자 토큰이 올바르지 않아요.")


def _env_students() -> list[dict]:
    """설정 파일(AUTOMATION_CODES)에 직접 적힌 수강생. 코드는 보여주지 않고 삭제도 막는다."""
    out = []
    for part in get_settings().automation_codes.split(","):
        code, _, name = part.strip().partition(":")
        if code:
            out.append({"name": name or code, "code": None, "source": "설정파일", "created": ""})
    return out


class StudentIn(BaseModel):
    name: str = Field(min_length=1, max_length=30)


@router.get("")
async def list_students(x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    file_rows = [
        {
            "name": s["name"],
            "code": s["code"],
            "source": "관리자",
            "created": s.get("created", ""),
            "birth": s.get("birth", ""),
            "phone": s.get("phone", ""),
        }
        for s in student_store.list_students()
    ]
    return file_rows + _env_students()


@router.post("")
async def add_student(req: StudentIn, x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    name = req.name.strip()
    if not name:
        raise HTTPException(422, "이름을 입력해 주세요.")
    if any(s["name"] == name for s in _env_students()):
        raise HTTPException(409, "설정 파일에 이미 있는 이름입니다.")
    try:
        row = student_store.add_student(name)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"name": row["name"], "code": row["code"], "source": "관리자", "created": row["created"]}


class ApproveIn(BaseModel):
    code: str = Field(min_length=6, max_length=40)


def _code_in_use(code: str) -> bool:
    env_codes = {part.strip().partition(":")[0] for part in get_settings().automation_codes.split(",")}
    return code in env_codes or code in student_store.file_codes()


@router.get("/requests")
async def list_requests(x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    return student_requests.list_all()


@router.post("/requests/{rid}/approve")
async def approve_request(rid: str, req: ApproveIn, x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    row = student_requests.get(rid)
    if row is None:
        raise HTTPException(404, "요청을 찾을 수 없어요.")
    if row["status"] != "pending":
        raise HTTPException(409, "이미 처리된 요청이에요.")
    code = req.code.strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,40}", code):
        raise HTTPException(422, "코드명은 영문·숫자·-·_ 로 6~40자여야 해요.")
    if _code_in_use(code):
        raise HTTPException(409, "이미 사용 중인 코드명이에요. 다른 이름을 정해 주세요.")
    try:
        student_store.add_student(
            row["name"],
            code=code,
            info={"birth": row.get("birth", ""), "phone": row.get("phone", "")},
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    updated = student_requests.set_status(rid, "approved", code)
    return {"ok": True, "name": updated["name"], "code": code}


@router.post("/requests/{rid}/reject")
async def reject_request(rid: str, x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    row = student_requests.get(rid)
    if row is None:
        raise HTTPException(404, "요청을 찾을 수 없어요.")
    if row["status"] != "pending":
        raise HTTPException(409, "이미 처리된 요청이에요.")
    student_requests.set_status(rid, "rejected")
    return {"ok": True}


@router.delete("/{name}")
async def remove_student(name: str, x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    if not student_store.remove_student(name):
        raise HTTPException(404, "관리자 화면에서 만든 수강생 중에 그 이름이 없어요.")
    return {"ok": True}
