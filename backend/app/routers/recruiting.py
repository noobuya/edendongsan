"""현장 실습 매칭 & 스킬 뱃지 API.

/api/jobs는 이미 AI 시공 렌더링 작업(photo job)이 쓰고 있어, 겹치지 않도록
이 기능은 /api/recruiting 아래에 둔다.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApplicationStatus, FieldJob, JobApplication, JobStatus, SkillBadge, User, UserBadge, UserRole
from app.schemas_recruiting import (
    FieldJobCreate,
    FieldJobRead,
    JobApplicationCreate,
    JobApplicationRead,
    SkillBadgeCreate,
    SkillBadgeRead,
    UserBadgeRead,
    UserCreate,
    UserRead,
)

router = APIRouter(prefix="/api/recruiting", tags=["recruiting"])


@router.post("/users", response_model=UserRead)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    user = User(**payload.model_dump())
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/badges", response_model=SkillBadgeRead)
def create_badge(payload: SkillBadgeCreate, db: Session = Depends(get_db)):
    badge = SkillBadge(**payload.model_dump())
    db.add(badge)
    db.commit()
    db.refresh(badge)
    return badge


@router.post("/users/{user_id}/badges/{badge_id}", response_model=UserBadgeRead)
def award_badge(user_id: int, badge_id: int, db: Session = Depends(get_db)):
    """교육 수료 등으로 수강생에게 뱃지를 지급한다(테스트용 수동 지급)."""
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


@router.post("/field-jobs", response_model=FieldJobRead)
def create_field_job(payload: FieldJobCreate, db: Session = Depends(get_db)):
    expert = db.get(User, payload.expert_id)
    if not expert or expert.role != UserRole.EXPERT:
        raise HTTPException(status_code=403, detail="전문가(EXPERT)만 공고를 올릴 수 있습니다.")
    if not db.get(SkillBadge, payload.required_badge_id):
        raise HTTPException(status_code=404, detail="요구 뱃지를 찾을 수 없습니다.")
    job = FieldJob(**payload.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.get("/field-jobs", response_model=list[FieldJobRead])
def list_open_field_jobs(db: Session = Depends(get_db)):
    return db.query(FieldJob).filter(FieldJob.status == JobStatus.OPEN).all()


@router.post("/field-jobs/{job_id}/apply", response_model=JobApplicationRead)
def apply_to_field_job(job_id: int, payload: JobApplicationCreate, db: Session = Depends(get_db)):
    """수강생이 공고에 지원한다. 공고가 요구하는 뱃지를 갖고 있는지부터 검증한다."""
    job = db.get(FieldJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다.")
    if job.status != JobStatus.OPEN:
        raise HTTPException(status_code=400, detail="마감되었거나 종료된 공고입니다.")

    student = db.get(User, payload.student_id)
    if not student or student.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="수강생(STUDENT)만 지원할 수 있습니다.")

    has_required_badge = (
        db.get(UserBadge, (student.id, job.required_badge_id)) is not None
    )
    if not has_required_badge:
        badge = db.get(SkillBadge, job.required_badge_id)
        badge_name = badge.badge_name if badge else "요구 뱃지"
        raise HTTPException(
            status_code=403,
            detail=f"'{badge_name}' 뱃지가 없어 지원할 수 없습니다.",
        )

    already_applied = (
        db.query(JobApplication)
        .filter(JobApplication.job_id == job_id, JobApplication.student_id == student.id)
        .first()
    )
    if already_applied:
        raise HTTPException(status_code=400, detail="이미 지원한 공고입니다.")

    application = JobApplication(job_id=job_id, student_id=student.id, status=ApplicationStatus.PENDING)
    db.add(application)
    db.commit()
    db.refresh(application)
    return application
