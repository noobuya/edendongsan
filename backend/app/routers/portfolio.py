"""서명 완료된 시공 건을 모아 보여주는 공개 쇼케이스 갤러리.

blog.py(사장님이 AI 글을 검수·발행하는 단계가 있는 공개 목록)와 달리, 이쪽은
사장님의 별도 액션 없이 status="done" & signature가 있으면 자동으로 올라온다.
발행 전 검수 단계가 없는 만큼 노출 범위를 의도적으로 좁게 잡아, 고객 이름·
연락처·금액은 절대 내보내지 않고 사진과 시공 항목 태그만 보여준다(PortfolioEntry
참고)."""
from fastapi import APIRouter

from app.quotes_store import list_quotes
from app.schemas import PortfolioEntry, PortfolioListResponse

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def _item_tags(estimate: dict | None) -> list[str]:
    if not estimate:
        return []
    tags: list[str] = []
    for line_item in estimate.get("line_items", []):
        name = line_item.get("item_name")
        if name and name not in tags:
            tags.append(name)
    return tags


@router.get("", response_model=PortfolioListResponse)
async def list_portfolio() -> PortfolioListResponse:
    entries = []
    for quote in list_quotes():
        if quote.get("status") != "done" or not quote.get("signature"):
            continue
        signature = quote.get("signature") or {}
        entries.append(
            PortfolioEntry(
                job_id=quote["job_id"],
                before_image_url=quote.get("original_image_url"),
                after_image_url=quote.get("rendered_image_url"),
                item_tags=_item_tags(quote.get("estimate")),
                completed_at=signature.get("signed_at") or quote.get("created_at") or "",
            )
        )
    entries.sort(key=lambda e: e.completed_at, reverse=True)
    return PortfolioListResponse(entries=entries)
