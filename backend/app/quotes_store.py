"""고객명이 붙은 완료된 견적서를 JSON 파일로 영속화한다.

app/jobs_store.py의 JOBS는 인메모리 딕셔너리라 서버 프로세스가 재시작되면
(--reload, 배포 재시작 등) 전부 사라진다. 그러면 사용자가 브라우저 "뒤로가기"로
방금 만든 견적서로 돌아가거나, 나중에 "불러오기"로 예전 견적을 다시 보려 할 때
아무것도 남아 있지 않게 된다. 완료된(status="done") 견적만 파일로 스냅샷을 남겨
이 문제를 해결한다.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from app import pricing_store

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


def set_negotiated_total(job_id: str, new_total_cost: int, note: str = "") -> dict | None:
    """고객과 조율한 최종 금액(부가세 포함)으로 견적의 총액을 덮어쓴다.

    AI가 산출한 원래 금액은 estimate.original_total_cost에 처음 한 번만 저장돼
    이후 몇 번을 더 조정해도 "원래 얼마였는지"는 그대로 남는다. 조정 한 건 한
    건은 price_adjustments에 쌓여(PriceAdjustment) 사장님이 나중에 왜 이
    금액이 됐는지 되짚어볼 수 있다 — 서명·현장조건과 달리 영업상 협의일 뿐
    법적 분쟁 기록이 아니므로, 몇 번이든 다시 조정할 수 있게 덮어쓰기를 막지
    않는다.

    공급가액·부가세는 estimator.py의 계산(vat = round(supply * rate), total =
    supply + vat)을 거꾸로 풀어 다시 채운다 — 영수증이 두 숫자를 따로 보여주는
    경우(vat가 있는 견적) 새 총액과 어긋나지 않게 하기 위해서다.

    [왜 — 2026-11-07 사장님 요청 "가격을 수동으로 고치면 안의 내용도 그 가격에
    맞게 고쳐지게"] 전엔 품목별 line_items는 그대로 두고 총액만 바꿔서, 고객
    영수증에 "품목 합계 ≠ 총액"인 어색한 상태가 남았다. 이제 품목별 subtotal도
    같은 비율로 같이 늘리거나 줄여 합계가 새 총액과 맞게 만든다. 자재비/인건비/
    경비(원가 분석, 사장님 전용)는 그대로 둔다 — 실제로 들어간 원가 자체가
    바뀐 건 아니고, 협의 마진(화면의 "협의가 기준 예상 수익")은 이미 이 원가
    기준으로 따로 계산되므로 원가까지 같이 바꾸면 그 계산이 어긋난다."""
    quote = load_quote(job_id)
    if quote is None or not quote.get("estimate"):
        return None
    estimate = quote["estimate"]

    current_total = estimate.get("total_cost", 0)
    if "original_total_cost" not in estimate or estimate["original_total_cost"] is None:
        estimate["original_total_cost"] = current_total

    vat_rate = pricing_store.effective()["vat_rate_percent"] / 100
    supply_amount = round(new_total_cost / (1 + vat_rate)) if vat_rate else new_total_cost
    vat = new_total_cost - supply_amount

    ratio = new_total_cost / current_total if current_total else 1
    line_items = estimate.get("line_items") or []
    for li in line_items:
        li["subtotal"] = round(li.get("subtotal", 0) * ratio)
    # 반올림으로 생기는 1~2원 차이는 가장 비싼 품목에 몰아 합계를 정확히 맞춘다.
    if line_items:
        drift = new_total_cost - vat - sum(li["subtotal"] for li in line_items)
        if drift:
            biggest = max(line_items, key=lambda li: li["subtotal"])
            biggest["subtotal"] += drift

    estimate.setdefault("price_adjustments", []).append(
        {
            "from_amount": current_total,
            "to_amount": new_total_cost,
            "note": note,
            "adjusted_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    estimate["total_cost"] = new_total_cost
    estimate["supply_amount"] = supply_amount
    estimate["vat"] = vat
    if estimate.get("deposit"):
        rate = estimate["deposit"]["rate_percent"]
        estimate["deposit"]["amount"] = round(new_total_cost * rate / 100)

    save_quote(job_id, quote)
    return quote


def set_payment_status(job_id: str, payment_status: str) -> dict | None:
    """견적의 결제 진행 상태(대기/계약금완료/잔금완료)를 기록한다. 서명·현장조건과
    달리 공사가 끝난 뒤에도(심지어 done이 아니어도) 여러 번 바뀔 수 있는 값이라
    덮어쓰기를 막지 않는다 — 입금이 밀리거나 분할로 들어오는 경우가 흔하다."""
    quote = load_quote(job_id)
    if quote is None:
        return None
    quote["payment_status"] = payment_status
    save_quote(job_id, quote)
    return quote


def append_change_order(job_id: str, change_order: dict) -> dict | None:
    """현장 추가 시공 한 건을 견적서에 추가한다. append_work_photo와 같은 패턴."""
    quote = load_quote(job_id)
    if quote is None:
        return None
    quote.setdefault("change_orders", []).append(change_order)
    save_quote(job_id, quote)
    return quote


def find_change_order(job_id: str, change_order_id: str) -> dict | None:
    """라우터가 서명 전에 "이미 서명됐는지"를 먼저 확인할 수 있게 조회만 한다
    (sign_job이 set_signature 호출 전에 quote.get("signature")를 먼저 보는 것과 같은 이유)."""
    quote = load_quote(job_id)
    if quote is None:
        return None
    for co in quote.get("change_orders", []):
        if co.get("id") == change_order_id:
            return co
    return None


def set_change_order_signature(job_id: str, change_order_id: str, signature: dict) -> dict | None:
    """고객이 추가 시공 건에 서명한다. set_signature와 같은 원칙으로, 이미 서명된
    건은 덮어쓰지 않는다 — 분쟁 방지 기록이라 한 번 받으면 바꾸지 않는다."""
    quote = load_quote(job_id)
    if quote is None:
        return None
    for co in quote.get("change_orders", []):
        if co.get("id") == change_order_id:
            if co.get("signature"):
                return None
            co["signature"] = signature
            save_quote(job_id, quote)
            return quote
    return None


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
