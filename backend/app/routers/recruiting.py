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
import io
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    ApplicationPhoto,
    ApplicationStatus,
    ApprovalStatus,
    BadgeEndorsement,
    CommunityComment,
    CommunityPost,
    FieldJob,
    JobApplication,
    JobAudience,
    JobReview,
    JobStatus,
    ScoutRequest,
    ScoutStatus,
    SkillBadge,
    User,
    UserBadge,
    UserRole,
)
from app.services.leveling import XP_PER_RATING_POINT
from app.services.qa_scan import scan_finish_quality
from app.schemas_recruiting import (
    AdminApplicationRow,
    AdminApproveIn,
    AdminFieldJobRow,
    AdminOverviewResponse,
    AdminUserCreate,
    AdminUserRow,
    ApplicantRead,
    ApplicationPhotoRead,
    CalendarJobRow,
    CommunityCommentCreate,
    CommunityCommentRead,
    CommunityPostCreate,
    CommunityPostDetailRead,
    CommunityPostRead,
    DepositConfirmIn,
    FieldJobCreate,
    FieldJobRead,
    JobApplicationDecisionIn,
    JobApplicationRead,
    JobReviewCreate,
    JobReviewRead,
    MyApplicationRead,
    MyBadgeRead,
    ScoutRequestCreate,
    ScoutRequestDecisionIn,
    ScoutRequestRead,
    SignupIn,
    SignupOut,
    SignupStatusOut,
    SkillBadgeCreate,
    SkillBadgeRead,
    StudentDirectoryRow,
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


def _job_to_read(job: FieldJob) -> dict:
    return {
        "id": job.id,
        "expert_id": job.expert_id,
        "location": job.location,
        "job_date": job.job_date,
        "required_badge_id": job.required_badge_id,
        "required_badge_name": job.required_badge.badge_name,
        "pay": job.pay,
        "status": job.status,
        "audience": job.audience,
        "deposit_confirmed": job.deposit_confirmed,
    }


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


@router.get("/admin/badges", response_model=list[SkillBadgeRead])
def admin_list_badges(x_admin_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    _require_admin(x_admin_token)
    return db.query(SkillBadge).all()


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
@router.get("/me", response_model=UserRead)
def whoami(current_user: User = Depends(require_access_code)):
    return current_user


@router.get("/badges", response_model=list[SkillBadgeRead])
def list_badges(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    return db.query(SkillBadge).all()


@router.get("/me/badges", response_model=list[MyBadgeRead])
def my_badges(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    rows = db.query(UserBadge).filter(UserBadge.user_id == current_user.id).all()
    return [
        {
            "badge_id": ub.badge_id,
            "badge_name": ub.badge.badge_name,
            "description": ub.badge.description,
            "acquired_date": ub.acquired_date,
        }
        for ub in rows
    ]


@router.get("/me/applications", response_model=list[MyApplicationRead])
def my_applications(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="조공(STUDENT)만 조회할 수 있습니다.")
    rows = db.query(JobApplication).filter(JobApplication.student_id == current_user.id).all()
    return [
        {
            "id": a.id,
            "status": a.status,
            "applied_at": a.applied_at,
            "job_id": a.job_id,
            "job_location": a.job.location,
            "job_date": a.job.job_date,
            "job_pay": a.job.pay,
            "job_status": a.job.status,
        }
        for a in rows
    ]


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
    return _job_to_read(job)


@router.get("/field-jobs", response_model=list[FieldJobRead])
def list_open_field_jobs(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    """내가 지원 대상인 공고만 본다 — STUDENT는 audience=STUDENT(기존 구인) 공고를,
    EXPERT는 audience=EXPERT(동급 기공 헬프콜) 공고를 본다. 역할 값과 JobAudience
    값을 똑같이 맞춰 둬서 한 줄로 변환된다(models.py의 JobAudience 참고)."""
    if current_user.role not in (UserRole.STUDENT, UserRole.EXPERT):
        raise HTTPException(status_code=403, detail="조공/전문가 계정만 조회할 수 있습니다.")
    jobs = (
        db.query(FieldJob)
        .filter(FieldJob.status == JobStatus.OPEN)
        .filter(FieldJob.audience == JobAudience(current_user.role.value))
        .all()
    )
    return [_job_to_read(j) for j in jobs]


@router.get("/me/field-jobs", response_model=list[FieldJobRead])
def my_posted_field_jobs(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    if current_user.role != UserRole.EXPERT:
        raise HTTPException(status_code=403, detail="전문가(EXPERT)만 조회할 수 있습니다.")
    jobs = db.query(FieldJob).filter(FieldJob.expert_id == current_user.id).all()
    return [_job_to_read(j) for j in jobs]


@router.get("/field-jobs/{job_id}/applications", response_model=list[ApplicantRead])
def list_applicants(job_id: int, current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    job = db.get(FieldJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다.")
    if current_user.role != UserRole.EXPERT or job.expert_id != current_user.id:
        raise HTTPException(status_code=403, detail="본인이 올린 공고만 지원자를 볼 수 있습니다.")
    rows = db.query(JobApplication).filter(JobApplication.job_id == job_id).all()
    return [
        {
            "id": a.id,
            "status": a.status,
            "applied_at": a.applied_at,
            "student_id": a.student_id,
            "student_name": a.student.name,
            "student_phone": a.student.phone_number,
            "student_level": a.student.level,
            "student_badge_count": a.student.badge_count,
        }
        for a in rows
    ]


@router.post("/field-jobs/{job_id}/applications/{application_id}/decision", response_model=JobApplicationRead)
def decide_application(
    job_id: int,
    application_id: int,
    payload: JobApplicationDecisionIn,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    """전문가가 지원자를 승인/거절한다. 승인하면 공고가 마감되고(한 자리),
    같은 공고의 나머지 대기중인 지원은 자동으로 거절된다."""
    job = db.get(FieldJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다.")
    if current_user.role != UserRole.EXPERT or job.expert_id != current_user.id:
        raise HTTPException(status_code=403, detail="본인이 올린 공고만 처리할 수 있습니다.")
    application = db.get(JobApplication, application_id)
    if not application or application.job_id != job_id:
        raise HTTPException(status_code=404, detail="지원 내역을 찾을 수 없습니다.")
    if application.status != ApplicationStatus.PENDING:
        raise HTTPException(status_code=409, detail="이미 처리된 지원이에요.")

    application.status = ApplicationStatus(payload.status)
    if application.status == ApplicationStatus.APPROVED:
        job.status = JobStatus.CLOSED
        others = (
            db.query(JobApplication)
            .filter(
                JobApplication.job_id == job_id,
                JobApplication.id != application_id,
                JobApplication.status == ApplicationStatus.PENDING,
            )
            .all()
        )
        for other in others:
            other.status = ApplicationStatus.REJECTED
    db.commit()
    db.refresh(application)
    return application


@router.post("/field-jobs/{job_id}/apply", response_model=JobApplicationRead)
def apply_to_field_job(
    job_id: int,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    """공고에 지원한다. 지원자는 접근 코드로 확인된 본인이고, 공고의 audience와
    역할이 맞는지(STUDENT 구인엔 STUDENT만, EXPERT 헬프콜엔 EXPERT만), 공고가
    요구하는 뱃지를 갖고 있는지부터 검증한다."""
    job = db.get(FieldJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다.")
    if job.status != JobStatus.OPEN:
        raise HTTPException(status_code=400, detail="마감되었거나 종료된 공고입니다.")

    if current_user.role.value != job.audience.value:
        audience_label = "조공(STUDENT)" if job.audience == JobAudience.STUDENT else "전문가(EXPERT)"
        raise HTTPException(status_code=403, detail=f"{audience_label}만 지원할 수 있습니다.")

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


@router.post("/field-jobs/{job_id}/applications/{application_id}/complete", response_model=JobApplicationRead)
def complete_application(
    job_id: int,
    application_id: int,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    """현장이 실제로 끝났음을 공고 주최자(기공)가 확인한다. APPROVED에서만 전이되고,
    이 상태가 돼야만 아래 /review를 쓸 수 있다 — '승인됐다'와 '실제로 나가서
    끝냈다'를 구분해야 서명 없는 견적처럼 가짜로 경험치를 쌓는 걸 막을 수 있다."""
    job = db.get(FieldJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다.")
    if current_user.role != UserRole.EXPERT or job.expert_id != current_user.id:
        raise HTTPException(status_code=403, detail="본인이 올린 공고만 처리할 수 있습니다.")
    application = db.get(JobApplication, application_id)
    if not application or application.job_id != job_id:
        raise HTTPException(status_code=404, detail="지원 내역을 찾을 수 없습니다.")
    if application.status != ApplicationStatus.APPROVED:
        raise HTTPException(status_code=409, detail="승인된 지원만 완료 처리할 수 있습니다.")
    application.status = ApplicationStatus.COMPLETED
    db.commit()
    db.refresh(application)
    return application


@router.post("/field-jobs/{job_id}/applications/{application_id}/review", response_model=JobReviewRead)
def review_application(
    job_id: int,
    application_id: int,
    payload: JobReviewCreate,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    """현장을 주최한 기공이 평점·뱃지 추천·코멘트를 남긴다. COMPLETED 상태에만,
    건당 한 번만(job_application_id UNIQUE) 쓸 수 있다. 여기서만 수강생 xp가
    오른다(services/leveling.py — 범위 결정 (A), 견적/블로그 이벤트는 안 건드림)."""
    job = db.get(FieldJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다.")
    if current_user.role != UserRole.EXPERT or job.expert_id != current_user.id:
        raise HTTPException(status_code=403, detail="본인이 올린 공고만 리뷰할 수 있습니다.")
    application = db.get(JobApplication, application_id)
    if not application or application.job_id != job_id:
        raise HTTPException(status_code=404, detail="지원 내역을 찾을 수 없습니다.")
    if application.status != ApplicationStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="현장이 완료 처리된 지원만 리뷰할 수 있습니다.")
    if application.review is not None:
        raise HTTPException(status_code=409, detail="이미 리뷰를 남긴 지원입니다.")

    badge = None
    if payload.recommended_badge_id is not None:
        badge = db.get(SkillBadge, payload.recommended_badge_id)
        if not badge:
            raise HTTPException(status_code=404, detail="추천할 뱃지를 찾을 수 없습니다.")
        if badge.requires_endorsements <= 0:
            raise HTTPException(
                status_code=422,
                detail="이 뱃지는 추천으로 발급되지 않습니다(관리자 전용 뱃지).",
            )

    review = JobReview(
        job_application_id=application_id,
        reviewer_id=current_user.id,
        rating=payload.rating,
        recommended_badge_id=payload.recommended_badge_id,
        comment=payload.comment,
    )
    db.add(review)

    student = application.student
    student.xp += payload.rating * XP_PER_RATING_POINT

    if badge is not None:
        already_holds = db.get(UserBadge, (student.id, badge.id)) is not None
        duplicate_endorsement = (
            db.query(BadgeEndorsement)
            .filter(
                BadgeEndorsement.endorser_id == current_user.id,
                BadgeEndorsement.target_user_id == student.id,
                BadgeEndorsement.badge_id == badge.id,
            )
            .first()
        )
        if not already_holds and not duplicate_endorsement:
            db.add(BadgeEndorsement(endorser_id=current_user.id, target_user_id=student.id, badge_id=badge.id))
            db.flush()
            endorsement_count = (
                db.query(BadgeEndorsement)
                .filter(BadgeEndorsement.target_user_id == student.id, BadgeEndorsement.badge_id == badge.id)
                .count()
            )
            if endorsement_count >= badge.requires_endorsements and not already_holds:
                db.add(UserBadge(user_id=student.id, badge_id=badge.id))

    db.commit()
    db.refresh(review)
    return review


@router.get("/me/reviews", response_model=list[JobReviewRead])
def my_reviews(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="조공(STUDENT)만 조회할 수 있습니다.")
    rows = (
        db.query(JobReview)
        .join(JobApplication, JobReview.job_application_id == JobApplication.id)
        .filter(JobApplication.student_id == current_user.id)
        .all()
    )
    return rows


# ── 지명 호출(Scout) ────────────────────────────────────────────────
@router.get("/students", response_model=list[StudentDirectoryRow])
def list_students(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    """기공이 지명 호출 대상을 고르는 수강생 디렉터리 — 레벨/뱃지로 신뢰도를 보고 고른다."""
    if current_user.role != UserRole.EXPERT:
        raise HTTPException(status_code=403, detail="전문가(EXPERT)만 조회할 수 있습니다.")
    students = (
        db.query(User)
        .filter(User.role == UserRole.STUDENT, User.approval_status == ApprovalStatus.APPROVED)
        .all()
    )
    return [
        {
            "id": s.id,
            "name": s.name,
            "level": s.level,
            "xp": s.xp,
            "badge_count": s.badge_count,
            "badge_names": [ub.badge.badge_name for ub in s.badges],
        }
        for s in students
    ]


@router.post("/scout-requests", response_model=ScoutRequestRead)
def create_scout_request(
    payload: ScoutRequestCreate,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.EXPERT:
        raise HTTPException(status_code=403, detail="전문가(EXPERT)만 지명 호출을 보낼 수 있습니다.")
    target = db.get(User, payload.target_user_id)
    if not target or target.role != UserRole.STUDENT or target.approval_status != ApprovalStatus.APPROVED:
        raise HTTPException(status_code=404, detail="대상 조공을 찾을 수 없습니다.")
    if payload.field_job_id is not None:
        job = db.get(FieldJob, payload.field_job_id)
        if not job or job.expert_id != current_user.id:
            raise HTTPException(status_code=404, detail="본인이 올린 공고만 연결할 수 있습니다.")

    scout_request = ScoutRequest(
        scout_id=current_user.id,
        target_user_id=payload.target_user_id,
        field_job_id=payload.field_job_id,
        message=payload.message,
    )
    db.add(scout_request)
    db.commit()
    db.refresh(scout_request)
    return _scout_request_to_read(scout_request)


@router.get("/me/scout-requests", response_model=list[ScoutRequestRead])
def my_scout_requests(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    """나(수강생)에게 들어온 지명 호출 목록."""
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="조공(STUDENT)만 조회할 수 있습니다.")
    rows = db.query(ScoutRequest).filter(ScoutRequest.target_user_id == current_user.id).all()
    return [_scout_request_to_read(r) for r in rows]


@router.get("/me/scout-requests/sent", response_model=list[ScoutRequestRead])
def my_sent_scout_requests(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    """내(기공)가 보낸 지명 호출 목록."""
    if current_user.role != UserRole.EXPERT:
        raise HTTPException(status_code=403, detail="전문가(EXPERT)만 조회할 수 있습니다.")
    rows = db.query(ScoutRequest).filter(ScoutRequest.scout_id == current_user.id).all()
    return [_scout_request_to_read(r) for r in rows]


@router.post("/scout-requests/{request_id}/decision", response_model=ScoutRequestRead)
def decide_scout_request(
    request_id: int,
    payload: ScoutRequestDecisionIn,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    scout_request = db.get(ScoutRequest, request_id)
    if not scout_request:
        raise HTTPException(status_code=404, detail="지명 호출을 찾을 수 없습니다.")
    if scout_request.target_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="본인에게 온 지명 호출만 응답할 수 있습니다.")
    if scout_request.status != ScoutStatus.PENDING:
        raise HTTPException(status_code=409, detail="이미 응답한 호출입니다.")
    scout_request.status = ScoutStatus(payload.status)
    db.commit()
    db.refresh(scout_request)
    return _scout_request_to_read(scout_request)


def _scout_request_to_read(r: ScoutRequest) -> dict:
    return {
        "id": r.id,
        "scout_id": r.scout_id,
        "scout_name": r.scout.name,
        "target_user_id": r.target_user_id,
        "target_name": r.target_user.name,
        "field_job_id": r.field_job_id,
        "message": r.message,
        "status": r.status,
        "created_at": r.created_at,
    }


# ── 실무 정보 공유 커뮤니티 ──────────────────────────────────────────
def _post_to_read(post: CommunityPost) -> dict:
    return {
        "id": post.id,
        "author_id": post.author_id,
        "author_name": post.author.name,
        "author_level": post.author.level,
        "category": post.category,
        "title": post.title,
        "body": post.body,
        "created_at": post.created_at,
        "comment_count": len(post.comments),
    }


def _comment_to_read(comment: CommunityComment) -> dict:
    return {
        "id": comment.id,
        "post_id": comment.post_id,
        "author_id": comment.author_id,
        "author_name": comment.author.name,
        "author_level": comment.author.level,
        "body": comment.body,
        "created_at": comment.created_at,
    }


@router.get("/community/posts", response_model=list[CommunityPostRead])
def list_community_posts(current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    posts = db.query(CommunityPost).order_by(CommunityPost.created_at.desc()).all()
    return [_post_to_read(p) for p in posts]


@router.post("/community/posts", response_model=CommunityPostRead)
def create_community_post(
    payload: CommunityPostCreate,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    post = CommunityPost(author_id=current_user.id, **payload.model_dump())
    db.add(post)
    db.commit()
    db.refresh(post)
    return _post_to_read(post)


@router.get("/community/posts/{post_id}", response_model=CommunityPostDetailRead)
def get_community_post(post_id: int, current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    post = db.get(CommunityPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    return {**_post_to_read(post), "comments": [_comment_to_read(c) for c in post.comments]}


@router.post("/community/posts/{post_id}/comments", response_model=CommunityCommentRead)
def create_community_comment(
    post_id: int,
    payload: CommunityCommentCreate,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    post = db.get(CommunityPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    comment = CommunityComment(post_id=post_id, author_id=current_user.id, body=payload.body)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return _comment_to_read(comment)


# ── AI 마감 검수 ─────────────────────────────────────────────────────
def _photo_to_read(photo: ApplicationPhoto) -> dict:
    try:
        qa_result = json.loads(photo.qa_result) if photo.qa_result else {}
    except json.JSONDecodeError:
        qa_result = {}
    return {
        "id": photo.id,
        "job_application_id": photo.job_application_id,
        "photo_url": photo.photo_url,
        "qa_result": qa_result,
        "uploaded_at": photo.uploaded_at,
    }


@router.post("/field-jobs/{job_id}/applications/{application_id}/photos", response_model=ApplicationPhotoRead)
async def upload_application_photo(
    job_id: int,
    application_id: int,
    photo: UploadFile = File(...),
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    """수강생 본인이 승인된(또는 완료된) 현장의 마감 사진을 올리면 Gemini Vision이
    들뜸·기포 등을 1차로 스캔한다 — 교육용 참고 판정이라 기공의 원격 검수 전
    자가 점검 느낌으로 둔다."""
    application = db.get(JobApplication, application_id)
    if not application or application.job_id != job_id:
        raise HTTPException(status_code=404, detail="지원 내역을 찾을 수 없습니다.")
    if application.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="본인 지원 건에만 사진을 올릴 수 있습니다.")
    if application.status not in (ApplicationStatus.APPROVED, ApplicationStatus.COMPLETED):
        raise HTTPException(status_code=409, detail="승인된 현장에만 사진을 올릴 수 있습니다.")

    raw_bytes = await photo.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="사진 파일이 비어 있습니다.")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            normalized = img.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(
            status_code=422, detail="사진 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다."
        ) from exc

    os.makedirs("storage/uploads", exist_ok=True)
    storage_path = f"storage/uploads/qa_{application_id}_{uuid.uuid4().hex[:8]}.jpg"
    normalized.save(storage_path, "JPEG", quality=90)

    qa_result = scan_finish_quality(storage_path)

    photo_row = ApplicationPhoto(
        job_application_id=application_id,
        photo_url="/" + storage_path.replace("storage/", "static/", 1),
        qa_result=json.dumps(qa_result, ensure_ascii=False),
    )
    db.add(photo_row)
    db.commit()
    db.refresh(photo_row)
    return _photo_to_read(photo_row)


@router.get("/field-jobs/{job_id}/applications/{application_id}/photos", response_model=list[ApplicationPhotoRead])
def list_application_photos(
    job_id: int,
    application_id: int,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    """본인(수강생)이거나 그 현장을 올린 기공만 볼 수 있다 — 기공은 여기서
    '원격 검수'를 한다."""
    application = db.get(JobApplication, application_id)
    if not application or application.job_id != job_id:
        raise HTTPException(status_code=404, detail="지원 내역을 찾을 수 없습니다.")
    job = db.get(FieldJob, job_id)
    is_owner_expert = current_user.role == UserRole.EXPERT and job is not None and job.expert_id == current_user.id
    is_applicant = application.student_id == current_user.id
    if not is_owner_expert and not is_applicant:
        raise HTTPException(status_code=403, detail="본인 지원 건이거나 본인이 올린 공고만 볼 수 있습니다.")
    rows = (
        db.query(ApplicationPhoto)
        .filter(ApplicationPhoto.job_application_id == application_id)
        .order_by(ApplicationPhoto.uploaded_at.desc())
        .all()
    )
    return [_photo_to_read(p) for p in rows]


# ── 스마트 캘린더 ────────────────────────────────────────────────────
@router.get("/calendar", response_model=list[CalendarJobRow])
def calendar_jobs(month: str, current_user: User = Depends(require_access_code), db: Session = Depends(get_db)):
    """month="YYYY-MM" — 내가 올린 공고 중 그 달에 해당하는 것만, 날짜별 투입
    현황(지원자 상태별 집계)과 함께 돌려준다."""
    if current_user.role != UserRole.EXPERT:
        raise HTTPException(status_code=403, detail="전문가(EXPERT)만 조회할 수 있습니다.")
    try:
        year_str, month_str = month.split("-")
        year, mon = int(year_str), int(month_str)
        if not 1 <= mon <= 12:
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=422, detail="month는 YYYY-MM 형식이어야 합니다.")

    start = datetime(year, mon, 1, tzinfo=timezone.utc)
    end = datetime(year + (1 if mon == 12 else 0), 1 if mon == 12 else mon + 1, 1, tzinfo=timezone.utc)

    jobs = (
        db.query(FieldJob)
        .filter(FieldJob.expert_id == current_user.id)
        .filter(FieldJob.job_date >= start, FieldJob.job_date < end)
        .all()
    )
    rows = []
    for job in jobs:
        summary = {"pending": 0, "approved": 0, "completed": 0, "rejected": 0}
        for application in job.applications:
            key = application.status.value.lower()
            if key in summary:
                summary[key] += 1
        rows.append(
            {
                "id": job.id,
                "location": job.location,
                "job_date": job.job_date,
                "pay": job.pay,
                "status": job.status,
                "audience": job.audience,
                "deposit_confirmed": job.deposit_confirmed,
                "applicants": summary,
            }
        )
    return rows


@router.post("/field-jobs/{job_id}/deposit", response_model=FieldJobRead)
def set_deposit_confirmed(
    job_id: int,
    payload: DepositConfirmIn,
    current_user: User = Depends(require_access_code),
    db: Session = Depends(get_db),
):
    job = db.get(FieldJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다.")
    if current_user.role != UserRole.EXPERT or job.expert_id != current_user.id:
        raise HTTPException(status_code=403, detail="본인이 올린 공고만 처리할 수 있습니다.")
    job.deposit_confirmed = payload.confirmed
    db.commit()
    db.refresh(job)
    return _job_to_read(job)


# ── 관리자 관제(Admin Oversight) ─────────────────────────────────────
@router.get("/admin/overview", response_model=AdminOverviewResponse)
def admin_overview(x_admin_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    """전체 매칭 현황 — 기공이 올린 공고(구인+헬프콜) 전부와, 공고마다 지원자
    정보·매칭 상태를 한 번에 묶어 내려준다. 한 번 조회로 끝나도록 N+1 없이
    관계(job.expert, job.applications, application.student)를 그대로 쓴다."""
    _require_admin(x_admin_token)
    jobs = db.query(FieldJob).order_by(FieldJob.job_date.desc()).all()
    rows = []
    for job in jobs:
        applications = [
            {
                "id": a.id,
                "applicant_name": a.student.name,
                "applicant_role": a.student.role,
                "status": a.status,
                "applied_at": a.applied_at,
            }
            for a in job.applications
        ]
        rows.append(
            {
                "id": job.id,
                "expert_name": job.expert.name,
                "location": job.location,
                "job_date": job.job_date,
                "pay": job.pay,
                "status": job.status,
                "audience": job.audience,
                "deposit_confirmed": job.deposit_confirmed,
                "applications": applications,
            }
        )
    return {"jobs": rows}


@router.post("/admin/applications/{application_id}/cancel", response_model=JobApplicationRead)
def admin_cancel_application(
    application_id: int,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """비정상적인 매칭을 관리자가 강제로 되돌리는 비상 조치 — 상태와 무관하게
    (승인·완료 상태여도) REJECTED로 되돌린다. 그 승인 때문에 CLOSED됐던 공고는
    다시 OPEN으로 돌리되, 같은 공고의 다른(이미 REJECTED된) 지원 건까지 자동으로
    되살리진 않는다 — 그건 또 다른 혼란을 만들 수 있어 범위 밖으로 둔다."""
    _require_admin(x_admin_token)
    application = db.get(JobApplication, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="지원 내역을 찾을 수 없습니다.")
    application.status = ApplicationStatus.REJECTED
    job = db.get(FieldJob, application.job_id)
    if job and job.status == JobStatus.CLOSED:
        job.status = JobStatus.OPEN
    db.commit()
    db.refresh(application)
    return application
