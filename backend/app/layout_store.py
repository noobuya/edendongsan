"""첫 화면(현장 등록~견적 화면) UI 요소의 위치·크기 조정값.

[왜 — 2026-11-05 사장님 요청 "배치가 엉망이다 — 설정모드에서 UI들을 길게 눌러
위치를 바꾸고 크기를 조정할 수 있게"]
사장님이 "배치 편집 모드"에서 요소를 길게 눌러 옮기거나 크기를 바꾸면 여기 저장된다.
사장님 기기뿐 아니라 그 화면을 보는 모든 기기(손님 기기 포함)에 똑같이 적용돼야
하므로(요청: "서버에 저장 — 모든 기기에 동일하게 적용"), 기기별 localStorage가 아니라
서버 파일 하나에 저장한다 — pricing_store.py의 overrides 패턴과 같다.

각 요소는 절대 좌표가 아니라 "원래 자리에서 얼마나 벗어났는지"(dx, dy, 픽셀)와
크기 배율(scale)만 담는다. 절대 좌표를 저장하면 화면 크기가 다른 기기에서 요소가
화면 밖으로 나가거나 서로 겹칠 수 있어서, 항상 기본 배치를 기준으로 한 상대값만
둔다 — 기본 배치 자체(각 요소의 자리)는 프런트 코드에 그대로 남아 있고, 이 값은
그 위에 얹는 보정일 뿐이다."""
import json
from pathlib import Path

from app.config import get_settings


def _path() -> Path:
    p = Path(get_settings().storage_dir) / "layout.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load() -> dict:
    p = _path()
    if not p.exists():
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        # 파일이 깨졌다고 첫 화면이 안 뜨면 안 된다 — 기본 배치로 조용히 돌아간다.
        return {}


def _write(data: dict) -> None:
    p = _path()
    tmp = p.with_suffix(".tmp.json")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    tmp.replace(p)


def save_element(element_id: str, adjustment: dict) -> dict:
    current = load()
    current[element_id] = adjustment
    _write(current)
    return current


def delete_element(element_id: str) -> dict:
    current = load()
    if element_id in current:
        del current[element_id]
        _write(current)
    return current
