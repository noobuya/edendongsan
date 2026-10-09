"""AI 제안서(고객 발송용 상세페이지) 한 건을 JSON 파일로 저장한다.

quotes_store.py와 같은 "파일 하나 = 레코드 하나" 방식이다. 견적(quote)과 달리
제안서는 완료된 견적이 없어도(사진 한 장만으로도) 만들 수 있어야 하므로 별도
저장소로 둔다 — job_id는 선택 필드로만 참조한다(있으면 나중에 그 견적의
sales_pitch를 카피에 반영하는 데 쓴다).

블로그(/api/blog)는 SEO 공개 목록이 목적이라 전부 공개되는 반면, 제안서는
"이 고객 한 명에게 보내는 비공개 링크"가 목적이라 draft/review 상태에서는
공개 조회(app/routers/proposals.py의 공개 라우터)에서 숨긴다 — status가
"published"인 것만 외부에 보인다.
"""
import json
from pathlib import Path

PROPOSALS_DIR = Path("storage/proposals")


def save_proposal(proposal_id: str, data: dict) -> None:
    PROPOSALS_DIR.mkdir(parents=True, exist_ok=True)
    path = PROPOSALS_DIR / f"{proposal_id}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_proposal(proposal_id: str) -> dict | None:
    path = PROPOSALS_DIR / f"{proposal_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def list_proposals() -> list[dict]:
    if not PROPOSALS_DIR.exists():
        return []
    rows = []
    for path in PROPOSALS_DIR.glob("*.json"):
        try:
            rows.append(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return rows


def delete_proposal(proposal_id: str) -> bool:
    path = PROPOSALS_DIR / f"{proposal_id}.json"
    if not path.exists():
        return False
    path.unlink()
    return True
