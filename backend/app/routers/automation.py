"""자동화 작업 API. 수강생 코드(X-Access-Code)로 접근을 제한한다."""
import hmac

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.automation import store
from app.automation.tasks import TASKS
from app.config import get_settings

router = APIRouter(prefix="/api/automation", tags=["automation"])


def _codes() -> dict[str, str]:
    """AUTOMATION_CODES="코드1:이름1,코드2:이름2" → {코드: 이름}"""
    out: dict[str, str] = {}
    for part in get_settings().automation_codes.split(","):
        code, _, name = part.strip().partition(":")
        if code:
            out[code] = name or code
    return out


def _owner(code: str | None) -> str:
    for known, name in _codes().items():
        if code and hmac.compare_digest(code.encode(), known.encode()):
            return name
    raise HTTPException(401, "수강생 코드가 올바르지 않아요.")


class LoginRequest(BaseModel):
    code: str


class JobRequest(BaseModel):
    task: str
    params: dict[str, str] = Field(default_factory=dict)


@router.post("/login")
async def login(req: LoginRequest):
    return {"name": _owner(req.code)}


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
