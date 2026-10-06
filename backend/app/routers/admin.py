"""관리자 전용 수강생 코드 관리 API. 요청마다 X-Admin-Token 헤더로 확인한다."""
import hmac

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app import student_store
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
        {"name": s["name"], "code": s["code"], "source": "관리자", "created": s.get("created", "")}
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


@router.delete("/{name}")
async def remove_student(name: str, x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    if not student_store.remove_student(name):
        raise HTTPException(404, "관리자 화면에서 만든 수강생 중에 그 이름이 없어요.")
    return {"ok": True}
