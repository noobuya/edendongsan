"""수강생 현장 실습 매칭 & 스킬 뱃지 시스템 — SQLAlchemy 모델.

User / SkillBadge / UserBadge(M:N) / FieldJob / JobApplication 다섯 테이블.
다른 기능(견적·자동화 등)의 저장소와는 분리된 별도 DB(storage/recruiting.db)다.
"""
import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    EXPERT = "EXPERT"
    STUDENT = "STUDENT"


class JobStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    COMPLETED = "COMPLETED"


class ApplicationStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    phone_number: Mapped[str] = mapped_column(String, nullable=False)
    daily_wage: Mapped[int] = mapped_column(Integer, default=0)

    badges: Mapped[list["UserBadge"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    posted_jobs: Mapped[list["FieldJob"]] = relationship(back_populates="expert", foreign_keys="FieldJob.expert_id")
    applications: Mapped[list["JobApplication"]] = relationship(back_populates="student", foreign_keys="JobApplication.student_id")


class SkillBadge(Base):
    __tablename__ = "skill_badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    badge_name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String, default="")

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
