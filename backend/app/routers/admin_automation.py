"""관리자 전용 자동화 로그·피드백 API. 요청마다 X-Admin-Token 헤더로 확인한다."""
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.automation import store
from app.automation.tasks import TASKS
from app.routers.admin import _require_admin

router = APIRouter(prefix="/api/admin/automation", tags=["admin"])

FEEDBACK_STATUSES = {"received", "reviewing", "done", "hold"}


@router.get("/tasks")
async def admin_tasks(x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    return [
        {"id": t.id, "title": t.title, "fields": [f.__dict__ for f in t.fields]} for t in TASKS.values()
    ]


@router.get("/jobs")
async def admin_jobs(x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    return store.list_all_for_admin()


class RerunIn(BaseModel):
    params: dict[str, str] = Field(default_factory=dict)


@router.post("/jobs/{job_id}/rerun")
async def admin_rerun(job_id: str, req: RerunIn, x_admin_token: str | None = Header(default=None)):
    """원래 작업의 수강생 이름으로 고친 값을 넣어 새 작업을 대기열에 넣는다.
    비밀번호 같은 secret 필드는 저장되어 있지 않으므로 다시 입력받는다."""
    _require_admin(x_admin_token)
    original = store.get_job_context(job_id)
    if original is None:
        raise HTTPException(404, "작업을 찾을 수 없어요.")
    task = TASKS.get(original["task"])
    if not task:
        raise HTTPException(404, "더 이상 없는 작업입니다.")
    owner = store.get_owner(job_id)
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


@router.get("/feedback")
async def admin_feedback(x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    return store.list_feedback()


class FeedbackStatusIn(BaseModel):
    status: str
    admin_note: str = Field(default="", max_length=500)


@router.patch("/feedback/{fid}")
async def admin_feedback_update(
    fid: str, req: FeedbackStatusIn, x_admin_token: str | None = Header(default=None)
):
    _require_admin(x_admin_token)
    if req.status not in FEEDBACK_STATUSES:
        raise HTTPException(422, "알 수 없는 상태입니다.")
    row = store.set_feedback_status(fid, req.status, req.admin_note.strip())
    if row is None:
        raise HTTPException(404, "피드백을 찾을 수 없어요.")
    return row
