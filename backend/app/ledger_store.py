"""가게부(장부)의 수동 입력 항목 저장소(SQLite). 매출(완료 견적)과 인건비(현장
지원 완료 건)는 이미 quotes_store/DB에 있는 사실을 그대로 집계하면 되지만,
유류비·공구 구입·세금처럼 이 앱에 원래 기록이 없는 거래는 사장님이 직접
입력해야 한다 — 그 입력만 이 저장소가 맡는다. journal_store.py와 같은
연결 패턴을 따른다."""
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from app.config import get_settings

LedgerType = str  # "income" | "expense" — 라우터가 Literal로 검증한다.


def _db_path() -> Path:
    p = Path(get_settings().storage_dir) / "ledger.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


@contextmanager
def _conn():
    con = sqlite3.connect(_db_path(), timeout=15, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS ledger_entries (
            id TEXT PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL,
            category TEXT NOT NULL, counterparty TEXT NOT NULL DEFAULT '',
            amount INTEGER NOT NULL, memo TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL, updated_at REAL NOT NULL)"""
    )
    try:
        yield con
    finally:
        con.close()


def _view(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "date": row["date"],
        "type": row["type"],
        "category": row["category"],
        "counterparty": row["counterparty"],
        "amount": row["amount"],
        "memo": row["memo"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def create_entry(date: str, type_: str, category: str, counterparty: str, amount: int, memo: str) -> dict:
    with _conn() as con:
        eid = uuid.uuid4().hex[:10]
        now = time.time()
        con.execute(
            "INSERT INTO ledger_entries (id, date, type, category, counterparty, amount, memo, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (eid, date, type_, category, counterparty, amount, memo, now, now),
        )
        return _view(con.execute("SELECT * FROM ledger_entries WHERE id=?", (eid,)).fetchone())


def list_entries(month: str | None = None) -> list[dict]:
    """month가 있으면 "YYYY-MM"으로 시작하는 날짜만. 날짜 내림차순, 같은 날짜는
    최근 입력한 순서(id 생성 시각)로 — 장부를 위에서부터 읽을 때 최신이 먼저 보인다."""
    with _conn() as con:
        if month:
            rows = con.execute(
                "SELECT * FROM ledger_entries WHERE date LIKE ? ORDER BY date DESC, created_at DESC",
                (f"{month}%",),
            ).fetchall()
        else:
            rows = con.execute("SELECT * FROM ledger_entries ORDER BY date DESC, created_at DESC").fetchall()
        return [_view(r) for r in rows]


def get_entry(entry_id: str) -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT * FROM ledger_entries WHERE id=?", (entry_id,)).fetchone()
        return _view(row) if row else None


def update_entry(
    entry_id: str, date: str, type_: str, category: str, counterparty: str, amount: int, memo: str
) -> dict | None:
    with _conn() as con:
        cur = con.execute(
            "UPDATE ledger_entries SET date=?, type=?, category=?, counterparty=?, amount=?, memo=?, updated_at=? "
            "WHERE id=?",
            (date, type_, category, counterparty, amount, memo, time.time(), entry_id),
        )
        if cur.rowcount == 0:
            return None
        return _view(con.execute("SELECT * FROM ledger_entries WHERE id=?", (entry_id,)).fetchone())


def delete_entry(entry_id: str) -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM ledger_entries WHERE id=?", (entry_id,))
        return cur.rowcount > 0
