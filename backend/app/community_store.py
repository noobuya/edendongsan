"""견적 공유 커뮤니티 저장소(SQLite).

완성된 견적에서 "공유하기"를 누르면, 고객 이름·현장 사진·job_id 없이 품목·단가·총액만
여기 저장된다 — 수강생들이 서로 시공 단가를 참고하는 게시판이다. 서버가 애초에 받지
않으니, 고객 개인정보가 여기로 새어 나갈 길이 없다. `automation/store.py`와 같은
연결 패턴(SQLite, WAL, CREATE TABLE IF NOT EXISTS)을 그대로 따른다."""
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from app.config import get_settings


def _db_path() -> Path:
    p = Path(get_settings().storage_dir) / "community.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


@contextmanager
def _conn():
    con = sqlite3.connect(_db_path(), timeout=15, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS shared_estimates (
            id TEXT PRIMARY KEY, author TEXT NOT NULL, item_names TEXT NOT NULL,
            line_items TEXT NOT NULL, total_cost INTEGER NOT NULL,
            note TEXT NOT NULL DEFAULT '', created REAL NOT NULL)"""
    )
    try:
        yield con
    finally:
        con.close()


def _view(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "author": row["author"],
        "item_names": json.loads(row["item_names"]),
        "line_items": json.loads(row["line_items"]),
        "total_cost": row["total_cost"],
        "note": row["note"],
        "created": row["created"],
    }


def create_share(author: str, item_names: list[str], line_items: list[dict], total_cost: int, note: str) -> dict:
    with _conn() as con:
        sid = uuid.uuid4().hex[:10]
        con.execute(
            "INSERT INTO shared_estimates (id, author, item_names, line_items, total_cost, note, created) "
            "VALUES (?,?,?,?,?,?,?)",
            (sid, author, json.dumps(item_names, ensure_ascii=False), json.dumps(line_items, ensure_ascii=False),
             total_cost, note, time.time()),
        )
        return _view(con.execute("SELECT * FROM shared_estimates WHERE id=?", (sid,)).fetchone())


def list_shares(q: str = "", limit: int = 100) -> list[dict]:
    needle = q.strip().lower()
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM shared_estimates ORDER BY created DESC LIMIT ?", (limit,)
        ).fetchall()
        shares = [_view(r) for r in rows]
    if not needle:
        return shares
    return [
        s for s in shares
        if needle in s["author"].lower() or any(needle in name.lower() for name in s["item_names"])
    ]


def get_share(share_id: str) -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT * FROM shared_estimates WHERE id=?", (share_id,)).fetchone()
        return _view(row) if row else None


def delete_share(share_id: str) -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM shared_estimates WHERE id=?", (share_id,))
        return cur.rowcount > 0
