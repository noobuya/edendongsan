"""고객명으로 검색 가능한 공개 시공 후기 블로그.
app/routers/quotes.py가 사장님(내부) 쪽 견적 관리/생성 API라면, 이 라우터는
그중 블로그 글이 생성된 건만 골라 외부에 공개하는 조회 전용 API다."""
from fastapi import APIRouter, HTTPException

from app.quotes_store import list_quotes, load_quote
from app.schemas import BlogDetailResponse, BlogListResponse, BlogSummary, WorkPhoto

router = APIRouter(prefix="/api/blog", tags=["blog"])

EXCERPT_LENGTH = 120


def _cover_image_url(quote: dict) -> str | None:
    for photo in quote.get("work_photos", []):
        if photo.get("stage") == "after":
            return photo["url"]
    return quote.get("rendered_image_url") or quote.get("original_image_url")


@router.get("", response_model=BlogListResponse)
async def list_blog_posts(q: str = ""):
    needle = q.strip().lower()
    posts: list[BlogSummary] = []
    for quote in list_quotes():
        post = quote.get("blog_post")
        if not post:
            continue
        customer_name = quote.get("customer_name") or "고객님"
        if needle and needle not in customer_name.lower() and needle not in post.get("title", "").lower():
            continue
        posts.append(
            BlogSummary(
                job_id=quote["job_id"],
                title=post["title"],
                customer_name=customer_name,
                created_at=post.get("created_at") or quote.get("created_at") or "",
                cover_image_url=_cover_image_url(quote),
                excerpt=(post.get("content") or "")[:EXCERPT_LENGTH],
            )
        )
    posts.sort(key=lambda p: p.created_at, reverse=True)
    return BlogListResponse(posts=posts)


@router.get("/{job_id}", response_model=BlogDetailResponse)
async def get_blog_detail(job_id: str):
    quote = load_quote(job_id)
    if quote is None or not quote.get("blog_post"):
        raise HTTPException(status_code=404, detail="블로그 글을 찾을 수 없습니다.")
    post = quote["blog_post"]
    estimate = quote.get("estimate") or {}
    # 견적 금액은 사장님 내부 견적 관리 화면에서만 보여주고, 공개 블로그 글에는
    # 절대 노출하지 않는다 — 시공 항목 이름만 태그처럼 보여준다.
    return BlogDetailResponse(
        job_id=job_id,
        title=post["title"],
        content=post["content"],
        customer_name=quote.get("customer_name") or "고객님",
        created_at=post.get("created_at") or quote.get("created_at") or "",
        before_image_url=quote.get("original_image_url"),
        after_image_url=quote.get("rendered_image_url"),
        work_photos=[WorkPhoto(**p) for p in quote.get("work_photos", [])],
        line_item_names=[li.get("item_name", "") for li in estimate.get("line_items", [])],
    )
