"""관리자 페이지에서 만든 수강생 코드 저장소(JSON 파일).

설정 파일(AUTOMATION_CODES)에 있는 코드는 그대로 동작하고, 여기 저장된 코드는 관리자
화면에서 추가·삭제한다. 파일은 storage/ 아래라 배포(git reset)로 지워지지 않는다.
"""
import json
import secrets
import string
import threading
import time
from pathlib import Path

from app.config import get_settings

_lock = threading.Lock()
ALPHABET = string.ascii_letters + string.digits


def _path() -> Path:
    p = Path(get_settings().storage_dir) / "students.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _read() -> list[dict]:
    p = _path()
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("students", [])


def _write(students: list[dict]) -> None:
    p = _path()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"students": students}, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


def list_students() -> list[dict]:
    with _lock:
        return list(_read())


def add_student(name: str) -> dict:
    with _lock:
        students = _read()
        if any(s["name"] == name for s in students):
            raise ValueError("이미 등록된 이름입니다.")
        code = "".join(secrets.choice(ALPHABET) for _ in range(12))
        row = {"name": name, "code": code, "created": time.strftime("%Y-%m-%d %H:%M")}
        students.append(row)
        _write(students)
        return row


def remove_student(name: str) -> bool:
    with _lock:
        students = _read()
        kept = [s for s in students if s["name"] != name]
        if len(kept) == len(students):
            return False
        _write(kept)
        return True


def file_codes() -> dict[str, str]:
    """{코드: 이름} — 자동화 로그인이 설정 파일 코드와 함께 확인한다."""
    return {s["code"]: s["name"] for s in list_students()}
