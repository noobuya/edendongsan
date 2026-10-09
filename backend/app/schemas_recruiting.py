"""수강생 현장 실습 매칭 & 스킬 뱃지 시스템 — Pydantic DTO.

기존 app/schemas.py는 견적(AI 시공) 도메인 전용이라, 섞이지 않도록 이 기능은
별도 파일로 둔다.
"""
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

from app.models import ApplicationStatus, ApprovalStatus, JobStatus, UserRole

# 가입 신청에서는 ADMIN 역할을 고를 수 없다 — 관리자 계정은 신청·승인 절차 바깥에서만 만든다.
SignupRole = Literal["EXPERT", "STUDENT"]


def _utc_iso(dt: datetime) -> str:
    """SQLite는 timezone 정보를 저장하지 않아(DateTime(timezone=True)를 써도) 읽어오면
    naive datetime이 된다 — 그런데 이 앱의 모든 datetime은 항상 UTC로 써넣으므로(User._now()
    등) 응답으로 내보낼 때 'Z'를 붙여 UTC임을 명시한다. 이게 없으면 프론트의 new Date(문자열)가
    naive 문자열을 브라우저 로컬시간(KST)으로 잘못 해석해 9시간이 밀린다."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


UTCDateTime = Annotated[datetime, PlainSerializer(_utc_iso, return_type=str)]


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    role: SignupRole
    phone_number: str = Field(min_length=9, max_length=20)
    daily_wage: int = 0


class SignupOut(BaseModel):
    request_token: str
    name: str
    approval_status: ApprovalStatus


class SignupStatusOut(BaseModel):
    name: str
    approval_status: ApprovalStatus
    # 승인됐을 때만 채워진다. 이 토큰을 아는 본인 기기에만 돌려준다.
    access_code: str | None = None


class AdminUserRow(BaseModel):
    """관리자 목록 화면용 — access_code·request_token은 내려주지 않는다."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: UserRole
    phone_number: str
    daily_wage: int
    approval_status: ApprovalStatus
    created_at: UTCDateTime


class AdminApproveIn(BaseModel):
    # 자동화 기능과 같은 규칙: 관리자가 코드명을 직접 정한다.
    access_code: str = Field(min_length=6, max_length=40, pattern=r"^[A-Za-z0-9_-]{6,40}$")


class AdminUserCreate(BaseModel):
    """관리자가 가입 신청 절차 없이 직접(즉시 승인 상태로) 계정을 만들 때 쓴다."""

    name: str = Field(min_length=1, max_length=30)
    role: UserRole
    phone_number: str = Field(min_length=9, max_length=20)
    daily_wage: int = 0
    access_code: str = Field(min_length=6, max_length=40, pattern=r"^[A-Za-z0-9_-]{6,40}$")


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: UserRole
    phone_number: str
    daily_wage: int
    approval_status: ApprovalStatus


class SkillBadgeCreate(BaseModel):
    badge_name: str
    description: str = ""


class SkillBadgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    badge_name: str
    description: str


class UserBadgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    badge_id: int
    acquired_date: UTCDateTime


class FieldJobCreate(BaseModel):
    """expert_id는 받지 않는다 — 접근 코드로 확인된 본인(EXPERT) 명의로 등록된다."""

    location: str
    job_date: datetime
    required_badge_id: int
    pay: int


class FieldJobRead(BaseModel):
    id: int
    expert_id: int
    location: str
    job_date: UTCDateTime
    required_badge_id: int
    required_badge_name: str
    pay: int
    status: JobStatus


class JobApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    student_id: int
    status: ApplicationStatus
    applied_at: UTCDateTime


class MyBadgeRead(BaseModel):
    badge_id: int
    badge_name: str
    description: str
    acquired_date: UTCDateTime


class MyApplicationRead(BaseModel):
    id: int
    status: ApplicationStatus
    applied_at: UTCDateTime
    job_id: int
    job_location: str
    job_date: UTCDateTime
    job_pay: int
    job_status: JobStatus


class ApplicantRead(BaseModel):
    id: int
    status: ApplicationStatus
    applied_at: UTCDateTime
    student_id: int
    student_name: str
    student_phone: str


JobApplicationDecisionValue = Literal["APPROVED", "REJECTED"]


class JobApplicationDecisionIn(BaseModel):
    status: JobApplicationDecisionValue
