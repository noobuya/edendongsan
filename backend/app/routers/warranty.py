"""시공 완료+서명된 건의 고객용 디지털 보증서 — 공개 조회 전용.

blog.py/portfolio.py와 같은 조회 전용 공개 라우터다. 포트폴리오 갤러리와 같은
기준(status=done & signature 있음)으로만 열려, 아직 진행 중이거나 서명 전인
건의 보증서가 고객에게 새 나가지 않는다."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app.quotes_store import load_quote
from app.schemas import WarrantyResponse

router = APIRouter(prefix="/api/warranty", tags=["warranty"])

WARRANTY_YEARS = 1

# 보증 약관·유지관리 팁은 AI가 지어내면 안 되는 값이라 고정 문구를 쓴다
# (PremiumReceipt.tsx의 GUARANTEES/FILM_NOTE와 같은 톤 — 실제로 지키는 내용만 적는다).
GENERIC_TIPS = [
    "시공 후 1~2일은 시공면에 물이 닿지 않게 관리해 주세요.",
    "강한 충격이나 날카로운 도구 접촉을 피해 주세요.",
    "오염 시 부드러운 마른 천으로 가볍게 닦아 주세요(유기용제 세제 사용 금지).",
    "모서리·이음새 부분이 들뜨면 직접 누르지 마시고 업체로 연락해 주세요.",
]


def _warranty_expiry(completed_at: str) -> str:
    try:
        dt = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
    except ValueError:
        dt = datetime.now(timezone.utc)
    return (dt + timedelta(days=365 * WARRANTY_YEARS)).isoformat()


@router.get("/{job_id}", response_model=WarrantyResponse)
async def get_warranty(job_id: str) -> WarrantyResponse:
    quote = load_quote(job_id)
    if quote is None or quote.get("status") != "done" or not quote.get("signature"):
        raise HTTPException(status_code=404, detail="보증서를 찾을 수 없습니다.")

    estimate = quote.get("estimate") or {}
    item_names: list[str] = []
    for line_item in estimate.get("line_items", []):
        name = line_item.get("item_name")
        if name and name not in item_names:
            item_names.append(name)

    completed_at = (quote.get("signature") or {}).get("signed_at") or quote.get("created_at") or ""
    return WarrantyResponse(
        job_id=job_id,
        item_names=item_names,
        completed_at=completed_at,
        warranty_expires_at=_warranty_expiry(completed_at),
        after_image_url=quote.get("rendered_image_url"),
        maintenance_tips=GENERIC_TIPS,
    )
