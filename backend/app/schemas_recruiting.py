"""수강생 현장 실습 매칭 & 스킬 뱃지 시스템 — Pydantic DTO.

기존 app/schemas.py는 견적(AI 시공) 도메인 전용이라, 섞이지 않도록 이 기능은
별도 파일로 둔다.
"""
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

from app.models import (
    ApplicationStatus,
    ApprovalStatus,
    CommunityCategory,
    JobAudience,
    JobStatus,
    ScoutStatus,
    UserRole,
)

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
    # 레벨 기반 생태계 — level/badge_count는 User.level/User.badge_count 프로퍼티에서
    # (from_attributes로) 그대로 읽어온다. 프론트는 이 값을 그대로 보여주기만 하면
    # 된다 — 클라이언트가 직접 계산하게 하면 위변조 여지가 생긴다.
    xp: int
    level: int
    badge_count: int


class SkillBadgeCreate(BaseModel):
    badge_name: str
    description: str = ""
    tier: int = Field(default=1, ge=1, le=5)
    is_official: bool = False
    requires_endorsements: int = Field(default=0, ge=0)


class SkillBadgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    badge_name: str
    description: str
    tier: int
    is_official: bool
    requires_endorsements: int


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
    # STUDENT(기본) = 기존처럼 수강생 대상 구인. EXPERT = 일이 넘치는 기공이 동급
    # 기공들에게 토스하는 긴급 헬프콜.
    audience: JobAudience = JobAudience.STUDENT


class FieldJobRead(BaseModel):
    id: int
    expert_id: int
    location: str
    job_date: UTCDateTime
    required_badge_id: int
    required_badge_name: str
    pay: int
    status: JobStatus
    audience: JobAudience


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
    student_level: int
    student_badge_count: int


JobApplicationDecisionValue = Literal["APPROVED", "REJECTED"]


class JobApplicationDecisionIn(BaseModel):
    status: JobApplicationDecisionValue


# ── 레벨 기반 생태계 확장 ────────────────────────────────────────────

class StudentDirectoryRow(BaseModel):
    """기공이 지명 호출(ScoutRequest) 대상을 고를 때 보는 수강생 목록 한 줄."""

    id: int
    name: str
    level: int
    xp: int
    badge_count: int
    badge_names: list[str]


class JobReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    # SkillBadge.requires_endorsements > 0인 뱃지만 추천할 수 있다 — 0(관리자 전용)인
    # 뱃지를 여기서 추천하면 422로 막는다(routers/recruiting.py 참고).
    recommended_badge_id: int | None = None
    comment: str = ""


class JobReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_application_id: int
    reviewer_id: int
    rating: int
    recommended_badge_id: int | None
    comment: str
    created_at: UTCDateTime


class ScoutRequestCreate(BaseModel):
    target_user_id: int
    field_job_id: int | None = None
    message: str = Field(default="", max_length=500)


class ScoutRequestRead(BaseModel):
    id: int
    scout_id: int
    scout_name: str
    target_user_id: int
    target_name: str
    field_job_id: int | None
    message: str
    status: ScoutStatus
    created_at: UTCDateTime


ScoutRequestDecisionLiteral = Literal["ACCEPTED", "DECLINED"]


class ScoutRequestDecisionIn(BaseModel):
    status: ScoutRequestDecisionLiteral


class CommunityPostCreate(BaseModel):
    category: CommunityCategory = CommunityCategory.QNA
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=5000)


class CommunityPostRead(BaseModel):
    id: int
    author_id: int
    author_name: str
    author_level: int
    category: CommunityCategory
    title: str
    body: str
    created_at: UTCDateTime
    comment_count: int


class CommunityCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class CommunityCommentRead(BaseModel):
    id: int
    post_id: int
    author_id: int
    author_name: str
    author_level: int
    body: str
    created_at: UTCDateTime


class CommunityPostDetailRead(CommunityPostRead):
    comments: list[CommunityCommentRead]
