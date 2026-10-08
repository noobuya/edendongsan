"""현장 실습 매칭 & 스킬 뱃지 API.

접근 모델은 자동화 기능(student_requests.py + admin.py)과 같다:
① 누구나 가입을 신청(/signup)하면 대기(PENDING) 상태로 쌓이고,
② 관리자(X-Admin-Token)가 검토해 코드를 정해 승인(/admin/requests/{id}/approve)해야
   그 코드로 나머지 API(X-Access-Code)를 쓸 수 있다. 승인 전·거절된 사람과
   코드를 모르는 사람은 아무것도 못 한다.

/api/jobs는 이미 AI 시공 렌더링 작업(photo job)이 쓰고 있어, 겹치지 않도록
이 기능은 /api/recruiting 아래에 둔다.
"""
import hmac
import re
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    ApplicationStatus,
    ApprovalStatus,
    FieldJob,
    JobApplication,
    JobStatus,
    SkillBadge,
    User,
    UserBadge,
    UserRole,
)
from app.schemas_recruiting import (
    AdminApproveIn,
    AdminUserCreate,
    AdminUserRow,
    FieldJobCreate,
    FieldJobRead,
    JobApplicationRead,
    SignupIn,
    SignupOut,
    SignupStatusOut,
    SkillBadgeCreate,
    SkillBadgeRead,
    UserBadgeRead,
    UserRead,
)

router = APIRouter(prefix="/api/recruiting", tags=["recruiting"])

PHONE_RE = re.compile(r"01[016789]\d{7,8}")


def _normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if not PHONE_RE.fullmatch(digits):
        raise HTTPException(422, "전화번호를 정확히 입력해 주세요. (예: 010-1234-5678)")
    return f"{digits[:3]}-{digits[3:-4]}-{digits[-4:]}"


def _require_admin(x_admin_token: str | None) -> None:
    expected = get_settings().admin_token
    if not expected:
        raise HTTPException(503, "관리자 토큰(ADMIN_TOKEN)이 서버에 설정되지 않았습니다.")
    if not x_admin_token or not hmac.compare_digest(x_admin_token.encode(), expected.encode()):
        raise HTTPException(401, "관리자 토큰이 올바르지 않아요.")


def require_access_code(
    x_access_code: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """승인된 사용자만 통과시킨다. 통과하면 그 본인(User)을 돌려준다 —
    student_id/expert_id를 요청 바디로 받지 않고 이 값으로만 신원을 확인한다."""
    if not x_access_code:
        raise HTTPException(401, "접근 코드(X-Access-Code)가 필요합니다.")
    user = (
        db.query(User)
        .filter(User.approval_status == ApprovalStatus.APPROVED)
        .filter(User.access_code.isnot(None))
        .filter(User.access_code == x_access_code)
        .first()
    )
    if not user or not hmac.compare_digest(user.access_code.encode(), x_access_code.encode()):
        raise HTTPException(401, "접근 코드가 올바르지 않습니다.")
    return user


# ── 가입 신청 (공개) ────────────────────────────────────────────────
@router.post("/signup", response_model=SignupOut)
def signup(payload: SignupIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "이름을 입력해 주세요.")
    phone = _normalize_phone(payload.phone_number)
    user = User(
        name=name,
        role=UserRole(payload.role),
        phone_number=phone,
        daily_wage=payload.daily_wage,
        approval_status=ApprovalStatus.PENDING,
        access_code=None,
        request_token=secrets.token_hex(16),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return SignupOut(request_token=user.request_token, name=user.name, approval_status=user.approval_status)


@router.get("/signup/{request_token}", response_model=SignupStatusOut)
def signup_status(request_token: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.request_token == request_token).first()
    if not user:
        raise HTTPException(404, "요청을 찾을 수 없어요.")
    return SignupStatusOut(
        name=user.name,
        approval_status=user.approval_status,
        access_code=user.access_code if user.approval_status == ApprovalStatus.APPROVED else None,
    )


# ── 관리자 전용 ─────────────────────────────────────────────────────
@router.get("/admin/requests", response_model=list[AdminUserRow])
def admin_list_requests(x_admin_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    _require_admin(x_admin_token)
    return db.query(User).order_by(User.created_at.desc()).all()


@router.post("/admin/requests/{user_id}/approve", response_model=AdminUserRow)
def admin_approve(
    user_id: int,
    payload: AdminApproveIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(x_admin_token)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "요청을 찾을 수 없어요.")
    if user.approval_status != ApprovalStatus.PENDING:
        raise HTTPException(409, "이미 처리된 요청이에요.")
    if db.query(User).filter(User.access_code == payload.access_code).first():
        raise HTTPException(409, "이미 사용 중인 코드명이에요. 다른 이름을 정해 주세요.")
    user.approval_status = ApprovalStatus.APPROVED
    user.access_code = payload.access_code
    db.commit()
    db.refresh(user)
    return user


@router.post("/admin/requests/{user_id}/reject", response_model=AdminUserRow)
def admin_reject(user_id: int, x_admin_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    _require_admin(x_admin_token)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "요청을 찾을 수 없어요.")
    if user.approval_status != ApprovalStatus.PENDING:
        raise HTTPException(409, "이미 처리된 요청이에요.")
    user.approval_status = ApprovalStatus.REJECTED
    db.commit()
    db.refresh(user)
    return user


@router.post("/admin/users", response_model=UserRead)
def admin_create_user(payload: AdminUserCreate, x_admin_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    """신청 절차 없이 관리자가 직접 즉시 승인 상태로 계정을 만든다."""
    _require_admin(x_admin_token)
    if db.query(User).filter(User.access_code == payload.access_code).first():
        raise HTTPException(409, "이미 사용 중인 코드명이에요. 다른 이름을 정해 주세요.")
    user = User(
        name=payload.name.strip(),
        role=payload.role,
        phone_number=_normalize_phone(payload.phone_number),
        daily_wage=payload.daily_wage,
        approval_status=ApprovalStatus.APPROVED,
        access_code=payload.access_code,
        request_token=secrets.token_hex(16),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/admin/badges", response_model=SkillBadgeRead)
def admin_create_badge(payload: SkillBadgeCreate, x_admin_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    _require_admin(x_admin_token)
    badge = SkillBadge(**payload.model_dump())
    db.add(badge)
    db.commit()
    db.refresh(badge)
    return badge


@router.post("/admin/users/{user_id}/badges/{badge_id}", response_model=UserBadgeRead)
def admin_award_badge(user_id: int, badge_id: int, x_admin_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    """교육 수료 등을 관리자가 확인하고 수강생에게 뱃지를 지급한다."""
    _require_admin(x_admin_token)
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    if not db.get(SkillBadge, badge_id):
        raise HTTPException(status_code=404, detail="뱃지를 찾을 수 없습니다.")
    existing = db.get(UserBadge, (user_id, badge_id))
    if existing:
        return existing
    user_badge = UserBadge(user_id=user_id, badge_id=badge_id)
    db.add(user_badge)
    db.commit()
    db.refresh(user_badge)
    return user_badge


# ── 승인된 사용자 전용 (X-Access-Code) ─────────────────────────────
@router.post("/field-jobs", response_model=FieldJobRead)
def create_field_job(
    payload: FieldJobCreate,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.EXPERT:
        raise HTTPException(status_code=403, detail="전문가(EXPERT)만 공고를 올릴 수 있습니다.")
    if not db.get(SkillBadge, payload.required_badge_id):
        raise HTTPException(status_code=404, detail="요구 뱃지를 찾을 수 없습니다.")
    job = FieldJob(expert_id=current_user.id, **payload.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.get("/field-jobs", response_model=list[FieldJobRead])
def list_open_field_jobs(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    return db.query(FieldJob).filter(FieldJob.status == JobStatus.OPEN).all()


@router.post("/field-jobs/{job_id}/apply", response_model=JobApplicationRead)
def apply_to_field_job(
    job_id: int,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    """수강생이 공고에 지원한다. 지원자는 접근 코드로 확인된 본인이고,
    공고가 요구하는 뱃지를 갖고 있는지부터 검증한다."""
    job = db.get(FieldJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다.")
    if job.status != JobStatus.OPEN:
        raise HTTPException(status_code=400, detail="마감되었거나 종료된 공고입니다.")

    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="수강생(STUDENT)만 지원할 수 있습니다.")

    has_required_badge = db.get(UserBadge, (current_user.id, job.required_badge_id)) is not None
    if not has_required_badge:
        badge = db.get(SkillBadge, job.required_badge_id)
        badge_name = badge.badge_name if badge else "요구 뱃지"
        raise HTTPException(
            status_code=403,
            detail=f"'{badge_name}' 뱃지가 없어 지원할 수 없습니다.",
        )

    already_applied = (
        db.query(JobApplication)
        .filter(JobApplication.job_id == job_id, JobApplication.student_id == current_user.id)
        .first()
    )
    if already_applied:
        raise HTTPException(status_code=400, detail="이미 지원한 공고입니다.")

    application = JobApplication(job_id=job_id, student_id=current_user.id, status=ApplicationStatus.PENDING)
    db.add(application)
    db.commit()
    db.refresh(application)
    return application
