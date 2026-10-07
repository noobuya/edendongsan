"""개인 작업 일지 저장소(SQLite). 글쓴이(owner)는 수강생 코드로 확인된 이름이고,
그 글은 본인과 관리자만 읽을 수 있다 — 접근 제어는 라우터(routers/journal.py)에서
하고, 이 모듈은 저장·조회만 맡는다. automation/store.py와 같은 연결 패턴을 따른다."""
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from app.config import get_settings


def _db_path() -> Path:
    p = Path(get_settings().storage_dir) / "journal.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


@contextmanager
def _conn():
    con = sqlite3.connect(_db_path(), timeout=15, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS journal_entries (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '', photos TEXT NOT NULL DEFAULT '[]',
            created REAL NOT NULL, updated REAL NOT NULL)"""
    )
    try:
        yield con
    finally:
        con.close()


def _view(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "owner": row["owner"],
        "title": row["title"],
        "content": row["content"],
        "photos": json.loads(row["photos"]),
        "created": row["created"],
        "updated": row["updated"],
    }


def create_entry(owner: str, title: str, content: str) -> dict:
    with _conn() as con:
        eid = uuid.uuid4().hex[:10]
        now = time.time()
        con.execute(
            "INSERT INTO journal_entries (id, owner, title, content, photos, created, updated) "
            "VALUES (?,?,?,?,'[]',?,?)",
            (eid, owner, title, content, now, now),
        )
        return _view(con.execute("SELECT * FROM journal_entries WHERE id=?", (eid,)).fetchone())


def list_for(owner: str) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM journal_entries WHERE owner=? ORDER BY created DESC", (owner,)
        ).fetchall()
        return [_view(r) for r in rows]


def list_all(limit: int = 200) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM journal_entries ORDER BY created DESC LIMIT ?", (limit,)
        ).fetchall()
        return [_view(r) for r in rows]


def get_entry(entry_id: str) -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT * FROM journal_entries WHERE id=?", (entry_id,)).fetchone()
        return _view(row) if row else None


def update_entry(entry_id: str, title: str, content: str) -> dict | None:
    with _conn() as con:
        cur = con.execute(
            "UPDATE journal_entries SET title=?, content=?, updated=? WHERE id=?",
            (title, content, time.time(), entry_id),
        )
        if cur.rowcount == 0:
            return None
        return _view(con.execute("SELECT * FROM journal_entries WHERE id=?", (entry_id,)).fetchone())


def delete_entry(entry_id: str) -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM journal_entries WHERE id=?", (entry_id,))
        return cur.rowcount > 0


def append_photo(entry_id: str, photo: dict) -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT photos FROM journal_entries WHERE id=?", (entry_id,)).fetchone()
        if row is None:
            return None
        photos = json.loads(row["photos"])
        photos.append(photo)
        con.execute(
            "UPDATE journal_entries SET photos=?, updated=? WHERE id=?",
            (json.dumps(photos, ensure_ascii=False), time.time(), entry_id),
        )
        return _view(con.execute("SELECT * FROM journal_entries WHERE id=?", (entry_id,)).fetchone())


def remove_photo(entry_id: str, photo_id: str) -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT photos FROM journal_entries WHERE id=?", (entry_id,)).fetchone()
        if row is None:
            return None
        photos = [p for p in json.loads(row["photos"]) if p["id"] != photo_id]
        con.execute(
            "UPDATE journal_entries SET photos=?, updated=? WHERE id=?",
            (json.dumps(photos, ensure_ascii=False), time.time(), entry_id),
        )
        return _view(con.execute("SELECT * FROM journal_entries WHERE id=?", (entry_id,)).fetchone())
