"""자동화 작업 대기열 저장소(SQLite).

API 프로세스와 워커 프로세스가 같은 파일을 쓰므로 SQLite를 쓴다(서버가 작아
Redis·Celery는 두지 않는다). 상태: queued → running → done | failed | canceled.
비밀번호처럼 `secret` 필드는 실행에 필요한 동안만 secrets 열에 두고, 끝나면 지운다.
"""
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import get_settings

MAX_QUEUED_PER_USER = 3
MAX_PER_DAY = 3  # 하루(한국 시간 자정 기준) 접수 가능 건수. 취소한 작업도 포함한다.
KST = timezone(timedelta(hours=9))


def _db_path() -> Path:
    p = Path(get_settings().storage_dir) / "automation.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


@contextmanager
def _conn():
    con = sqlite3.connect(_db_path(), timeout=15, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, task TEXT NOT NULL,
            params TEXT NOT NULL, secrets TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL, log TEXT NOT NULL DEFAULT '', result TEXT,
            error TEXT, created REAL NOT NULL, started REAL, finished REAL)"""
    )
    con.execute(
        """CREATE TABLE IF NOT EXISTS feedback (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL,
            message TEXT NOT NULL, job_id TEXT, status TEXT NOT NULL DEFAULT 'received',
            admin_note TEXT NOT NULL DEFAULT '', created REAL NOT NULL)"""
    )
    try:
        yield con
    finally:
        con.close()


def _public(row: sqlite3.Row, con: sqlite3.Connection) -> dict:
    position = None
    if row["status"] == "queued":
        # 내 앞에 있는 대기 작업 + 실행 중 작업 + 나 (1이면 곧 내 차례)
        ahead = con.execute(
            "SELECT COUNT(*) FROM jobs WHERE status='queued' AND created <= ?", (row["created"],)
        ).fetchone()[0]
        running = con.execute("SELECT COUNT(*) FROM jobs WHERE status='running'").fetchone()[0]
        position = ahead + running
    return {
        "id": row["id"],
        "task": row["task"],
        "status": row["status"],
        "position": position,
        "log": row["log"].splitlines()[-20:],
        "result": json.loads(row["result"]) if row["result"] else None,
        "error": row["error"],
        "created": row["created"],
        "finished": row["finished"],
    }


def enqueue(owner: str, task: str, params: dict, secrets: dict) -> dict:
    with _conn() as con:
        waiting = con.execute(
            "SELECT COUNT(*) FROM jobs WHERE owner=? AND status IN ('queued','running')", (owner,)
        ).fetchone()[0]
        if waiting >= MAX_QUEUED_PER_USER:
            raise ValueError(f"한 번에 {MAX_QUEUED_PER_USER}건까지만 대기할 수 있어요. 끝난 뒤 다시 요청해주세요.")
        today_start = datetime.now(KST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        today = con.execute(
            "SELECT COUNT(*) FROM jobs WHERE owner=? AND created >= ?", (owner, today_start)
        ).fetchone()[0]
        if today >= MAX_PER_DAY:
            raise ValueError(f"하루에 {MAX_PER_DAY}건까지만 요청할 수 있어요. 내일 다시 이용해 주세요.")
        job_id = uuid.uuid4().hex[:12]
        con.execute(
            "INSERT INTO jobs (id, owner, task, params, secrets, status, created) VALUES (?,?,?,?,?,'queued',?)",
            (job_id, owner, task, json.dumps(params, ensure_ascii=False), json.dumps(secrets), time.time()),
        )
        return _public(con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone(), con)


def get(job_id: str, owner: str | None = None) -> dict | None:
    with _conn() as con:
        if owner is None:
            row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        else:
            row = con.execute("SELECT * FROM jobs WHERE id=? AND owner=?", (job_id, owner)).fetchone()
        return _public(row, con) if row else None


def list_for(owner: str, limit: int = 20) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM jobs WHERE owner=? ORDER BY created DESC LIMIT ?", (owner, limit)
        ).fetchall()
        return [_public(r, con) for r in rows]


def cancel(job_id: str, owner: str) -> bool:
    with _conn() as con:
        cur = con.execute(
            "UPDATE jobs SET status='canceled', secrets='{}', finished=? WHERE id=? AND owner=? AND status='queued'",
            (time.time(), job_id, owner),
        )
        return cur.rowcount > 0


# ---- 워커 전용 ----

def claim_next() -> str | None:
    """가장 오래된 대기 작업 하나를 running으로 바꾸고 id를 돌려준다."""
    with _conn() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
        if not row:
            con.execute("COMMIT")
            return None
        con.execute("UPDATE jobs SET status='running', started=? WHERE id=?", (time.time(), row["id"]))
        con.execute("COMMIT")
        return row["id"]


def load_for_run(job_id: str) -> tuple[str, dict, dict]:
    with _conn() as con:
        r = con.execute("SELECT task, params, secrets FROM jobs WHERE id=?", (job_id,)).fetchone()
        return r["task"], json.loads(r["params"]), json.loads(r["secrets"])


def append_log(job_id: str, line: str) -> None:
    with _conn() as con:
        con.execute("UPDATE jobs SET log = log || ? WHERE id=?", (line.strip() + "\n", job_id))


def finish(job_id: str, result: dict | None, error: str | None) -> None:
    with _conn() as con:
        con.execute(
            "UPDATE jobs SET status=?, result=?, error=?, secrets='{}', finished=? WHERE id=?",
            (
                "failed" if error else "done",
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                error,
                time.time(),
                job_id,
            ),
        )


def recover_stuck() -> None:
    """워커가 재시작될 때, 이전에 running으로 남은 작업을 실패 처리한다."""
    with _conn() as con:
        con.execute(
            "UPDATE jobs SET status='failed', error='서버가 재시작되어 중단되었습니다. 다시 요청해주세요.', "
            "secrets='{}', finished=? WHERE status='running'",
            (time.time(),),
        )


# ---- 피드백 (수강생 → 관리자) ----

def _job_context(con: sqlite3.Connection, job_id: str | None) -> dict:
    """피드백에 붙여 보여줄 작업 정보. secrets는 빼고 파라미터와 로그 끝부분만 준다."""
    if not job_id:
        return {}
    row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if row is None:
        return {"missing": True}
    return {
        "task": row["task"],
        "status": row["status"],
        "error": row["error"],
        "params": json.loads(row["params"]),
        "log_tail": row["log"].splitlines()[-20:],
    }


def _feedback_view(row: sqlite3.Row, con: sqlite3.Connection) -> dict:
    return {
        "id": row["id"],
        "owner": row["owner"],
        "kind": row["kind"],
        "message": row["message"],
        "job_id": row["job_id"],
        "status": row["status"],
        "admin_note": row["admin_note"],
        "created": row["created"],
        "context": _job_context(con, row["job_id"]),
    }


def add_feedback(owner: str, kind: str, message: str, job_id: str | None) -> dict:
    with _conn() as con:
        if job_id and con.execute(
            "SELECT 1 FROM jobs WHERE id=? AND owner=?", (job_id, owner)
        ).fetchone() is None:
            raise LookupError("작업을 찾을 수 없어요.")
        fid = uuid.uuid4().hex[:12]
        con.execute(
            "INSERT INTO feedback (id, owner, kind, message, job_id, created) VALUES (?,?,?,?,?,?)",
            (fid, owner, kind, message, job_id or None, time.time()),
        )
        return _feedback_view(con.execute("SELECT * FROM feedback WHERE id=?", (fid,)).fetchone(), con)


def list_feedback() -> list[dict]:
    with _conn() as con:
        rows = con.execute("SELECT * FROM feedback ORDER BY created DESC").fetchall()
        return [_feedback_view(r, con) for r in rows]


def set_feedback_status(fid: str, status: str, note: str) -> dict | None:
    with _conn() as con:
        cur = con.execute("UPDATE feedback SET status=?, admin_note=? WHERE id=?", (status, note, fid))
        if cur.rowcount == 0:
            return None
        return _feedback_view(con.execute("SELECT * FROM feedback WHERE id=?", (fid,)).fetchone(), con)


# ---- 관리자 작업 로그·재실행 ----

def list_all_for_admin(limit: int = 200) -> list[dict]:
    with _conn() as con:
        rows = con.execute("SELECT * FROM jobs ORDER BY created DESC LIMIT ?", (limit,)).fetchall()
        return [
            {
                "id": r["id"],
                "owner": r["owner"],
                "task": r["task"],
                "status": r["status"],
                "params": json.loads(r["params"]),
                "log": r["log"].splitlines()[-200:],
                "error": r["error"],
                "created": r["created"],
                "finished": r["finished"],
            }
            for r in rows
        ]


def get_job_context(job_id: str) -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT task, params FROM jobs WHERE id=?", (job_id,)).fetchone()
        return {"task": row["task"], "params": json.loads(row["params"])} if row else None


def get_owner(job_id: str) -> str | None:
    with _conn() as con:
        row = con.execute("SELECT owner FROM jobs WHERE id=?", (job_id,)).fetchone()
        return row["owner"] if row else None
