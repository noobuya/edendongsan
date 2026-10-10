"""수강생 현장 실습 매칭 & 스킬 뱃지 시스템 — SQLAlchemy 모델.

User / SkillBadge / UserBadge(M:N) / FieldJob / JobApplication 다섯 테이블에,
레벨 기반 생태계 확장으로 BadgeEndorsement / JobReview / ScoutRequest /
CommunityPost / CommunityComment 다섯 테이블을 더한다. 다른 기능(견적·자동화
등)의 저장소와는 분리된 별도 DB(storage/recruiting.db)다.
"""
import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    EXPERT = "EXPERT"
    STUDENT = "STUDENT"


class ApprovalStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class JobStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    COMPLETED = "COMPLETED"


class ApplicationStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    # 승인된 지원이 실제로 현장에서 끝났을 때만 거친다 — JobReview는 이 상태로
    # 전이된 지원 건에만 남길 수 있다(services/leveling.py 참고).
    COMPLETED = "COMPLETED"


class JobAudience(str, enum.Enum):
    """FieldJob을 누구에게 보여줄지 — 값을 UserRole과 똑같이 맞춰 둬서
    `JobAudience(current_user.role.value)`로 바로 변환해 필터링할 수 있게 한다."""

    STUDENT = "STUDENT"
    EXPERT = "EXPERT"


class ScoutStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"


class CommunityCategory(str, enum.Enum):
    TIP = "TIP"
    MATERIAL_SHARE = "MATERIAL_SHARE"
    QNA = "QNA"


class User(Base):
    """가입 신청과 승인된 계정을 같은 테이블로 다룬다 — 신청 시점엔
    approval_status=PENDING·access_code=None이고, 관리자가 승인하면서
    access_code를 정해줘야 그 코드로 나머지 API를 쓸 수 있다
    (자동화 기능의 student_requests.py + admin.py 승인 흐름과 같은 방식)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    phone_number: Mapped[str] = mapped_column(String, nullable=False)
    daily_wage: Mapped[int] = mapped_column(Integer, default=0)

    approval_status: Mapped[ApprovalStatus] = mapped_column(Enum(ApprovalStatus), default=ApprovalStatus.PENDING)
    # 관리자가 승인하면서 직접 정해주는 코드(자동화 기능과 동일한 방식) — 이게 있어야
    # X-Access-Code로 본인 확인이 된다. 승인 전엔 None.
    access_code: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    # 가입 신청자 본인만 자기 승인 상태를 조회할 수 있게 하는 추측 불가능한 토큰.
    # 관리자 화면(목록 조회)에는 절대 내려주지 않는다.
    request_token: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # 레벨링 생태계 — JobReview가 쌓일 때만 올라간다(services/leveling.py의
    # XP_PER_RATING_POINT 참고). 견적·블로그 쪽 이벤트는 건드리지 않는다(범위 결정 (A)).
    xp: Mapped[int] = mapped_column(Integer, default=0)

    badges: Mapped[list["UserBadge"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    posted_jobs: Mapped[list["FieldJob"]] = relationship(back_populates="expert", foreign_keys="FieldJob.expert_id")
    applications: Mapped[list["JobApplication"]] = relationship(back_populates="student", foreign_keys="JobApplication.student_id")

    @property
    def badge_count(self) -> int:
        return len(self.badges)

    @property
    def level(self) -> int:
        """레벨을 컬럼으로 저장하지 않고 뱃지 관계에서 매번 계산한다 — 뱃지가
        추천·회수될 때마다 별도 컬럼을 동기화해야 하는 부담도, 클라이언트가 값을
        조작해 보낼 여지도 둘 다 없앤다. UserRead 등은 from_attributes로 이 속성을
        그대로 읽어간다."""
        from app.services.leveling import compute_level

        level, _score = compute_level([ub.badge for ub in self.badges])
        return level


class SkillBadge(Base):
    __tablename__ = "skill_badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    badge_name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String, default="")
    # 레벨 계산식(services/leveling.py)의 입력값 — 난이도가 높을수록 레벨에 더 많이 기여한다.
    tier: Mapped[int] = mapped_column(Integer, default=1)
    # 교육원 수료·사업자 인증처럼 관리자만 수여할 수 있는 공식 뱃지. 이게 하나라도
    # 있어야 Lv.2를 넘는 레벨 상한 해제가 된다(compute_level 참고) — XP/뱃지가
    # 아무리 쌓여도 이 뱃지 없이는 Lv.3 이상으로 못 간다.
    is_official: Mapped[bool] = mapped_column(default=False)
    # 0이면 지금까지처럼 관리자가 /admin/users/{id}/badges/{id}로 즉시 수여하는
    # 뱃지(동료 추천 경로 자체가 없다 — JobReview에서 이 뱃지를 추천하는 것도 막는다).
    # 0보다 크면 자기 추천 1인 1표로 셀프 발급을 못 하게(BadgeEndorsement의
    # UNIQUE(endorser_id, target_user_id, badge_id)) 서로 다른 기공 N명의 추천이
    # 쌓여야 자동으로 UserBadge가 생긴다 — '알판 시공' '실리콘 마감' 같은 핵심
    # 기술 뱃지는 생성할 때 이 값만 2~3으로 잡으면 된다.
    requires_endorsements: Mapped[int] = mapped_column(Integer, default=0)

    holders: Mapped[list["UserBadge"]] = relationship(back_populates="badge", cascade="all, delete-orphan")


class UserBadge(Base):
    """유저가 뱃지를 획득한 기록 (User-SkillBadge M:N 매핑 테이블)."""

    __tablename__ = "user_badges"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    badge_id: Mapped[int] = mapped_column(ForeignKey("skill_badges.id"), primary_key=True)
    acquired_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship(back_populates="badges")
    badge: Mapped["SkillBadge"] = relationship(back_populates="holders")


class FieldJob(Base):
    """전문가(EXPERT)가 올리는 현장 구인 공고."""

    __tablename__ = "field_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expert_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    location: Mapped[str] = mapped_column(String, nullable=False)
    job_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    required_badge_id: Mapped[int] = mapped_column(ForeignKey("skill_badges.id"), nullable=False)
    pay: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.OPEN)
    # STUDENT(기본) = 기존처럼 수강생 대상 구인 공고. EXPERT = 일이 넘치는 기공이
    # 동급 기공들에게 토스하는 긴급 헬프콜 — 새 테이블을 만들지 않고 이 필드 하나로
    # 기존 공고·지원·승인 로직을 그대로 재사용한다(지원자 role 검증만 이 값 기준으로 바뀐다).
    audience: Mapped[JobAudience] = mapped_column(Enum(JobAudience), default=JobAudience.STUDENT)
    # 캘린더 대시보드용 — 기공이 직접 체크하는 자체 플래그다. 고객 견적(quotes
    # 시스템)의 실제 DepositInfo와는 연결돼 있지 않다(두 저장소를 잇는 건 범위 밖 —
    # 포트폴리오 갤러리 때와 같은 결정). "이 현장 건 계약금 받았음"을 기공 스스로
    # 표시해 두는 용도.
    deposit_confirmed: Mapped[bool] = mapped_column(default=False)

    expert: Mapped["User"] = relationship(back_populates="posted_jobs", foreign_keys=[expert_id])
    required_badge: Mapped["SkillBadge"] = relationship()
    applications: Mapped[list["JobApplication"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class JobApplication(Base):
    """수강생(STUDENT)의 구인 공고 지원 내역."""

    __tablename__ = "job_applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("field_jobs.id"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[ApplicationStatus] = mapped_column(Enum(ApplicationStatus), default=ApplicationStatus.PENDING)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    job: Mapped["FieldJob"] = relationship(back_populates="applications")
    student: Mapped["User"] = relationship(back_populates="applications", foreign_keys=[student_id])
    review: Mapped["JobReview"] = relationship(back_populates="application", uselist=False, cascade="all, delete-orphan")
    photos: Mapped[list["ApplicationPhoto"]] = relationship(back_populates="application", cascade="all, delete-orphan")


class BadgeEndorsement(Base):
    """기공이 수강생에게 뱃지 하나를 추천한 기록. 같은 (추천인, 대상, 뱃지)
    조합은 한 번만 쌓일 수 있어(UniqueConstraint) 한 사람이 혼자 추천 수를
    불려 SkillBadge.requires_endorsements를 조작하는 걸 막는다."""

    __tablename__ = "badge_endorsements"
    __table_args__ = (UniqueConstraint("endorser_id", "target_user_id", "badge_id", name="uq_badge_endorsement"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    endorser_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    target_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    badge_id: Mapped[int] = mapped_column(ForeignKey("skill_badges.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    endorser: Mapped["User"] = relationship(foreign_keys=[endorser_id])
    target_user: Mapped["User"] = relationship(foreign_keys=[target_user_id])
    badge: Mapped["SkillBadge"] = relationship()


class JobReview(Base):
    """현장이 끝난(JobApplication.status=COMPLETED) 지원 건에 대해, 공고를 올린
    기공이 수강생에게 남기는 평점·뱃지 추천·코멘트. job_application_id가
    UNIQUE라 같은 건으로 여러 번 리뷰를 써서 뱃지 추천 수를 불릴 수 없다.
    생성 시 수강생 xp가 오르고(services/leveling.py의 XP_PER_RATING_POINT),
    recommended_badge_id가 있으면 BadgeEndorsement가 함께 쌓인다."""

    __tablename__ = "job_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_application_id: Mapped[int] = mapped_column(ForeignKey("job_applications.id"), unique=True, nullable=False)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    recommended_badge_id: Mapped[int | None] = mapped_column(ForeignKey("skill_badges.id"), nullable=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    application: Mapped["JobApplication"] = relationship(back_populates="review")
    reviewer: Mapped["User"] = relationship(foreign_keys=[reviewer_id])
    recommended_badge: Mapped["SkillBadge | None"] = relationship()


class ScoutRequest(Base):
    """기공(EXPERT)이 특정 수강생(STUDENT)을 콕 집어 보내는 지명 호출."""

    __tablename__ = "scout_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scout_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    target_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    # 특정 공고와 연결할 수도(이 공고 도와주실 수 있나요), 자유 제안일 수도 있어 nullable.
    field_job_id: Mapped[int | None] = mapped_column(ForeignKey("field_jobs.id"), nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[ScoutStatus] = mapped_column(Enum(ScoutStatus), default=ScoutStatus.PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    scout: Mapped["User"] = relationship(foreign_keys=[scout_id])
    target_user: Mapped["User"] = relationship(foreign_keys=[target_user_id])
    field_job: Mapped["FieldJob | None"] = relationship()


class CommunityPost(Base):
    """현장 노하우·남는 자재 나눔·시공 Q&A 게시글."""

    __tablename__ = "community_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    category: Mapped[CommunityCategory] = mapped_column(Enum(CommunityCategory), default=CommunityCategory.QNA)
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    author: Mapped["User"] = relationship()
    comments: Mapped[list["CommunityComment"]] = relationship(back_populates="post", cascade="all, delete-orphan")


class CommunityComment(Base):
    """댓글은 1단계만 지원한다 — 대댓글까지는 지금 범위에서 과설계로 판단."""

    __tablename__ = "community_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("community_posts.id"), nullable=False)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    post: Mapped["CommunityPost"] = relationship(back_populates="comments")
    author: Mapped["User"] = relationship()


class ApplicationPhoto(Base):
    """수강생이 승인된 현장에서 올리는 마감 사진 — AI 1차 스캔 결과(qa_result,
    services/qa_scan.py)와 함께 저장해 기공이 원격으로 검수할 수 있게 한다.
    고객에게 보여주는 보증서(quotes 시스템의 WorkPhoto)와는 별개의, 현장 교육·
    원격 검수 전용 시스템이다."""

    __tablename__ = "application_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_application_id: Mapped[int] = mapped_column(ForeignKey("job_applications.id"), nullable=False)
    photo_url: Mapped[str] = mapped_column(String, nullable=False)
    # Gemini Vision 판정 결과를 JSON 문자열 그대로 저장(qa_scan.py의 scan_finish_quality
    # 반환값). 참고용 1차 판정이지 하자 보수 책임을 가르는 공식 판정이 아니다.
    qa_result: Mapped[str] = mapped_column(Text, default="")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    application: Mapped["JobApplication"] = relationship(back_populates="photos")
