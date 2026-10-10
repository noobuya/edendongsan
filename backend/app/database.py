"""현장 실습 매칭·스킬 뱃지 기능 전용 SQLAlchemy 연결.

기존 앱은 JSON 파일(student_store.py 등)이나 raw sqlite3(automation/store.py)로
저장소를 다뤄 왔는데, 이 기능은 User-SkillBadge-FieldJob-JobApplication처럼
테이블 간 관계가 많아 ORM(SQLAlchemy)을 쓴다. 다른 저장소들과 같은 규칙으로
storage_dir 아래에 파일을 둔다(배포 시 git reset으로 지워지지 않음).
"""
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


def _db_path() -> Path:
    p = Path(get_settings().storage_dir) / "recruiting.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


engine = create_engine(
    f"sqlite:///{_db_path()}",
    # SQLite 커넥션은 기본적으로 연 스레드에서만 써야 하는데, FastAPI가 요청마다
    # 다른 스레드에서 처리할 수 있어 꺼야 한다. 세션을 요청 하나당 하나만 쓰면 안전하다.
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


# Base.metadata.create_all()은 "없는 테이블"만 만들고 "이미 있는 테이블의 새 컬럼"은
# 추가해주지 않는다 — 이 프로젝트엔 Alembic 같은 마이그레이션 도구가 없어서(다른
# 저장소도 전부 파일/raw sqlite3라 지금까지 필요 없었다), 레벨링 생태계 확장으로
# 기존 테이블(users/skill_badges/field_jobs)에 새 컬럼이 생길 때마다 여기 한 줄씩
# 추가하는 수동 마이그레이션으로 메운다. 이미 컬럼이 있으면 조용히 건너뛰어
# 서버를 몇 번 재시작해도 안전하다(멱등).
_RECRUITING_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    # (테이블, 컬럼, "컬럼 ADD" DDL 조각)
    ("users", "xp", "INTEGER DEFAULT 0"),
    ("skill_badges", "tier", "INTEGER DEFAULT 1"),
    ("skill_badges", "is_official", "INTEGER DEFAULT 0"),
    ("skill_badges", "requires_endorsements", "INTEGER DEFAULT 0"),
    ("field_jobs", "audience", "VARCHAR DEFAULT 'STUDENT'"),
]


def migrate_recruiting_db() -> None:
    with engine.begin() as conn:
        for table, column, ddl in _RECRUITING_COLUMN_MIGRATIONS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
