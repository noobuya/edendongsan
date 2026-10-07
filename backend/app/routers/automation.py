"""자동화 작업 API. 수강생 코드(X-Access-Code)로 접근을 제한한다."""
import datetime
import hmac
import re
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.automation import store
from app.automation.tasks import TASKS
from app.config import get_settings
from app import student_requests, student_store

router = APIRouter(prefix="/api/automation", tags=["automation"])


def _codes() -> dict[str, str]:
    """AUTOMATION_CODES="코드1:이름1,코드2:이름2" + 관리자 페이지에서 만든 코드 → {코드: 이름}"""
    out: dict[str, str] = {}
    for part in get_settings().automation_codes.split(","):
        code, _, name = part.strip().partition(":")
        if code:
            out[code] = name or code
    out.update(student_store.file_codes())
    return out


def _owner(code: str | None) -> str:
    for known, name in _codes().items():
        if code and hmac.compare_digest(code.encode(), known.encode()):
            return name
    raise HTTPException(401, "수강생 코드가 올바르지 않아요.")


def resolve_owner(code: str | None) -> str | None:
    """수강생 코드면 이름을, 아니면 None을 돌려준다(예외를 던지지 않는다).
    작업 일지처럼 다른 라우터에서 "이 코드가 누구인지"만 확인할 때 쓴다."""
    try:
        return _owner(code)
    except HTTPException:
        return None


class LoginRequest(BaseModel):
    code: str


class JobRequest(BaseModel):
    task: str
    params: dict[str, str] = Field(default_factory=dict)


@router.post("/login")
async def login(req: LoginRequest):
    return {"name": _owner(req.code)}


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    birth: str = Field(min_length=10, max_length=10, description="YYYY-MM-DD")
    phone: str = Field(min_length=10, max_length=16)
    consent: bool


@router.post("/requests")
async def request_access(req: SignupIn):
    name = req.name.strip()
    if not name:
        raise HTTPException(422, "이름을 입력해 주세요.")
    if not req.consent:
        raise HTTPException(422, "개인정보 수집·이용에 동의해 주세요.")
    try:
        birth = datetime.date.fromisoformat(req.birth).isoformat()
    except ValueError as exc:
        raise HTTPException(422, "생년월일을 YYYY-MM-DD 형식으로 입력해 주세요.") from exc
    digits = re.sub(r"\D", "", req.phone)
    if not re.fullmatch(r"01[016789]\d{7,8}", digits):
        raise HTTPException(422, "전화번호를 정확히 입력해 주세요. (예: 010-1234-5678)")
    phone = f"{digits[:3]}-{digits[3:-4]}-{digits[-4:]}"
    try:
        row = student_requests.create(name, birth, phone)
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc
    return {"id": row["id"], "status": row["status"], "name": row["name"]}


@router.get("/requests/{rid}")
async def request_status(rid: str):
    row = student_requests.get(rid)
    if row is None:
        raise HTTPException(404, "요청을 찾을 수 없어요.")
    out = {"id": row["id"], "status": row["status"], "name": row["name"]}
    # 승인된 코드는 요청 번호를 가진 이 기기에만 돌려준다.
    if row["status"] == "approved":
        out["code"] = row["code"]
    return out


@router.get("/tasks")
async def list_tasks(x_access_code: str | None = Header(default=None)):
    _owner(x_access_code)
    return [
        {"id": t.id, "title": t.title, "description": t.description, "fields": [f.__dict__ for f in t.fields]}
        for t in TASKS.values()
    ]


@router.post("/jobs")
async def create_job(req: JobRequest, x_access_code: str | None = Header(default=None)):
    owner = _owner(x_access_code)
    task = TASKS.get(req.task)
    if not task:
        raise HTTPException(404, "없는 작업입니다.")
    params: dict[str, str] = {}
    secrets: dict[str, str] = {}
    for f in task.fields:
        value = (req.params.get(f.key) or "").strip()
        if f.required and not value:
            raise HTTPException(422, f"'{f.label}'을(를) 입력해주세요.")
        if len(value) > 2000:
            raise HTTPException(422, f"'{f.label}'이(가) 너무 깁니다.")
        (secrets if f.secret else params)[f.key] = value
    try:
        return store.enqueue(owner, task.id, params, secrets)
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc


@router.get("/jobs")
async def my_jobs(x_access_code: str | None = Header(default=None)):
    return store.list_for(_owner(x_access_code))


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, x_access_code: str | None = Header(default=None)):
    job = store.get(job_id, _owner(x_access_code))
    if not job:
        raise HTTPException(404, "작업을 찾을 수 없어요.")
    return job


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, x_access_code: str | None = Header(default=None)):
    if not store.cancel(job_id, _owner(x_access_code)):
        raise HTTPException(409, "대기 중인 작업만 취소할 수 있어요.")
    return {"ok": True}


class FeedbackIn(BaseModel):
    kind: Literal["bug", "improve", "other"]
    message: str = Field(min_length=1, max_length=1000)
    job_id: str | None = None


@router.post("/feedback")
async def send_feedback(req: FeedbackIn, x_access_code: str | None = Header(default=None)):
    owner = _owner(x_access_code)
    message = req.message.strip()
    if not message:
        raise HTTPException(422, "내용을 입력해 주세요.")
    try:
        return store.add_feedback(owner, req.kind, message, req.job_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
