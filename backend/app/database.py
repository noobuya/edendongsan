"""현장 실습 매칭·스킬 뱃지 기능 전용 SQLAlchemy 연결.

기존 앱은 JSON 파일(student_store.py 등)이나 raw sqlite3(automation/store.py)로
저장소를 다뤄 왔는데, 이 기능은 User-SkillBadge-FieldJob-JobApplication처럼
테이블 간 관계가 많아 ORM(SQLAlchemy)을 쓴다. 다른 저장소들과 같은 규칙으로
storage_dir 아래에 파일을 둔다(배포 시 git reset으로 지워지지 않음).
"""
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
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


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
