"""고객명이 붙은 완료된 견적서를 JSON 파일로 영속화한다.

app/jobs_store.py의 JOBS는 인메모리 딕셔너리라 서버 프로세스가 재시작되면
(--reload, 배포 재시작 등) 전부 사라진다. 그러면 사용자가 브라우저 "뒤로가기"로
방금 만든 견적서로 돌아가거나, 나중에 "불러오기"로 예전 견적을 다시 보려 할 때
아무것도 남아 있지 않게 된다. 완료된(status="done") 견적만 파일로 스냅샷을 남겨
이 문제를 해결한다.
"""
import json
from pathlib import Path

QUOTES_DIR = Path("storage/quotes")


def save_quote(job_id: str, snapshot: dict) -> None:
    QUOTES_DIR.mkdir(parents=True, exist_ok=True)
    path = QUOTES_DIR / f"{job_id}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False)


def load_quote(job_id: str) -> dict | None:
    path = QUOTES_DIR / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def append_work_photo(job_id: str, photo: dict) -> dict | None:
    """현장 작업 사진 한 장을 견적서에 추가한다. 견적서가 없으면(job_id가 잘못됐거나
    아직 시뮬레이션이 완료되지 않았으면) None을 돌려주고 아무것도 쓰지 않는다."""
    quote = load_quote(job_id)
    if quote is None:
        return None
    quote.setdefault("work_photos", []).append(photo)
    save_quote(job_id, quote)
    return quote


def remove_work_photo(job_id: str, photo_id: str) -> dict | None:
    quote = load_quote(job_id)
    if quote is None:
        return None
    quote["work_photos"] = [p for p in quote.get("work_photos", []) if p.get("id") != photo_id]
    save_quote(job_id, quote)
    return quote


def set_signature(job_id: str, signature: dict) -> dict | None:
    """고객이 현장에서 그린 서명을 저장한다. 이미 서명이 있으면 덮어쓰지 않는다
    (한 번 서명하면 끝 — 실수로 다시 그려 덮어쓰는 사고를 막는다. 다시 받아야
    하면 clear_signature로 먼저 지운다)."""
    quote = load_quote(job_id)
    if quote is None or quote.get("signature"):
        return None
    quote["signature"] = signature
    save_quote(job_id, quote)
    return quote


def clear_signature(job_id: str) -> dict | None:
    quote = load_quote(job_id)
    if quote is None:
        return None
    quote.pop("signature", None)
    save_quote(job_id, quote)
    return quote


def set_site_conditions(job_id: str, conditions: dict) -> dict | None:
    """시공 현장 조건(온도·하지 점검)을 기록한다. 서명과 달리 작업 중 수시로 다시
    확인할 수 있는 작업 기록이라(법적 합의가 아니다), 덮어쓰기를 막지 않는다."""
    quote = load_quote(job_id)
    if quote is None:
        return None
    quote["site_conditions"] = conditions
    save_quote(job_id, quote)
    return quote


def set_blog_post(job_id: str, blog_post: dict) -> dict | None:
    quote = load_quote(job_id)
    if quote is None:
        return None
    quote["blog_post"] = blog_post
    save_quote(job_id, quote)
    return quote


def clear_blog_post(job_id: str) -> dict | None:
    quote = load_quote(job_id)
    if quote is None:
        return None
    quote.pop("blog_post", None)
    save_quote(job_id, quote)
    return quote


def list_quotes() -> list[dict]:
    if not QUOTES_DIR.exists():
        return []
    quotes = []
    for path in QUOTES_DIR.glob("*.json"):
        try:
            with open(path, encoding="utf-8") as f:
                quotes.append(json.load(f))
        except (json.JSONDecodeError, OSError):
            continue
    # 정렬 키는 반드시 문자열로 눌러서 쓴다.
    # get(..., "")은 키가 아예 없을 때만 기본값을 주므로, 값이 None으로 저장된
    # 견적서가 하나라도 섞이면 str과 None을 비교하다 목록 전체가 500으로 죽는다.
    # 그러면 앱은 "서버에 연결되지 않았습니다"만 띄워서, 정작 서버는 멀쩡한데
    # 원인을 찾을 수 없게 된다. 견적서 하나가 망가져도 나머지는 보여야 한다.
    quotes.sort(key=lambda q: q.get("created_at") or "", reverse=True)
    return quotes
