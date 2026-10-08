"""수강생 현장 실습 매칭 & 스킬 뱃지 시스템 — Pydantic DTO.

기존 app/schemas.py는 견적(AI 시공) 도메인 전용이라, 섞이지 않도록 이 기능은
별도 파일로 둔다.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import ApplicationStatus, JobStatus, UserRole


class UserCreate(BaseModel):
    name: str
    role: UserRole
    phone_number: str
    daily_wage: int = 0


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: UserRole
    phone_number: str
    daily_wage: int


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
    acquired_date: datetime


class FieldJobCreate(BaseModel):
    expert_id: int
    location: str
    job_date: datetime
    required_badge_id: int
    pay: int


class FieldJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    expert_id: int
    location: str
    job_date: datetime
    required_badge_id: int
    pay: int
    status: JobStatus


class JobApplicationCreate(BaseModel):
    student_id: int


class JobApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    student_id: int
    status: ApplicationStatus
    applied_at: datetime
