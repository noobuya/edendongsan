"""AI 가상시공 비교판(/compare) 한 건을 JSON 파일로 저장한다.

proposal_store.py와 같은 "파일 하나 = 레코드 하나" 방식이다. 비교판은 완료된
견적(job)과 무관하게(시공전 사진 + 외부 AI로 만든 시공후 옵션 사진들만으로)
만들 수 있어 별도 저장소로 둔다. status가 "published"인 것만 공개 조회
(routers/comparison.py의 공개 라우터)에서 보인다 — proposal과 같은 원칙."""
import json
from pathlib import Path

BOARDS_DIR = Path("storage/comparison_boards")


def save_board(board_id: str, data: dict) -> None:
    BOARDS_DIR.mkdir(parents=True, exist_ok=True)
    path = BOARDS_DIR / f"{board_id}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_board(board_id: str) -> dict | None:
    path = BOARDS_DIR / f"{board_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def list_boards() -> list[dict]:
    if not BOARDS_DIR.exists():
        return []
    rows = []
    for path in BOARDS_DIR.glob("*.json"):
        try:
            rows.append(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return rows


def delete_board(board_id: str) -> bool:
    path = BOARDS_DIR / f"{board_id}.json"
    if not path.exists():
        return False
    path.unlink()
    return True
