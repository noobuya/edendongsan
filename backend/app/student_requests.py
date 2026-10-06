"""수강생 가입(승인) 요청 저장소(JSON 파일).

학생이 이름으로 요청하면 pending으로 쌓이고, 관리자가 코드명을 정해 승인하면 approved가 된다.
학생 기기는 요청 번호(UUID)로만 자기 상태를 확인하므로, 승인된 코드는 그 기기에만 전달된다.
"""
import json
import threading
import time
import uuid
from pathlib import Path

from app.config import get_settings

_lock = threading.Lock()
MAX_PENDING = 100


def _path() -> Path:
    p = Path(get_settings().storage_dir) / "student_requests.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _read() -> list[dict]:
    p = _path()
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("requests", [])


def _write(rows: list[dict]) -> None:
    p = _path()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"requests": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


def create(name: str, birth: str, phone: str) -> dict:
    with _lock:
        rows = _read()
        if sum(1 for r in rows if r["status"] == "pending") >= MAX_PENDING:
            raise ValueError("지금은 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")
        row = {
            "id": uuid.uuid4().hex,
            "name": name,
            # 생년월일·전화번호는 관리자 화면에서만 보인다(학생 상태 조회 API에는 싣지 않는다).
            "birth": birth,
            "phone": phone,
            "consented_at": time.strftime("%Y-%m-%d %H:%M"),
            "status": "pending",
            "code": None,
            "created": time.strftime("%Y-%m-%d %H:%M"),
        }
        rows.append(row)
        _write(rows)
        return dict(row)


def get(rid: str) -> dict | None:
    with _lock:
        for r in _read():
            if r["id"] == rid:
                return dict(r)
    return None


def list_all() -> list[dict]:
    with _lock:
        rows = [dict(r) for r in _read()]
    order = {"pending": 0, "approved": 1, "rejected": 2}
    return sorted(rows, key=lambda r: (order.get(r["status"], 9), r["created"]), reverse=False)


def set_status(rid: str, status: str, code: str | None = None) -> dict | None:
    with _lock:
        rows = _read()
        for r in rows:
            if r["id"] == rid:
                r["status"] = status
                r["code"] = code
                r["decided"] = time.strftime("%Y-%m-%d %H:%M")
                _write(rows)
                return dict(r)
    return None
