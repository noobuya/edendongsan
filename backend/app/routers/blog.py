"""고객명으로 검색 가능한 공개 시공 후기 블로그.
app/routers/quotes.py가 사장님(내부) 쪽 견적 관리/생성 API라면, 이 라우터는
그중 블로그 글이 생성된 건만 골라 외부에 공개하는 조회 전용 API다."""
import hashlib
import os

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.quotes_store import list_quotes, load_quote
from app.schemas import BlogDetailResponse, BlogListResponse, BlogSummary, WorkPhoto
from app.services.blog_video import make_compare_gif, make_compare_mp4
from app.services.brand_banner import make_brand_banner
from app.business_info import BUSINESS_NAME, BUSINESS_PHONE, BUSINESS_SERVICE_AREA

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
        hashtags=post.get("hashtags") or [],
        video_url=(
            f"/static/results/{job_id}_blog_video.mp4"
            if os.path.exists(f"storage/results/{job_id}_blog_video.mp4")
            else None
        ),
        video_status=quote.get("video_status"),
    )


@router.get("/brand/{variant}")
async def get_brand_banner(variant: str):
    """네이버 블로그에 넣을 업체 배너 이미지 — top(상단 상호 배너) / bottom(하단 전화 상담
    배너). 상호·전화번호가 바뀌면 파일 이름이 바뀌어 자동으로 새로 만든다
    (services/brand_banner.py)."""
    if variant not in ("top", "bottom"):
        raise HTTPException(status_code=404, detail="없는 배너입니다.")
    key = hashlib.md5(f"{BUSINESS_NAME}|{BUSINESS_PHONE}|{BUSINESS_SERVICE_AREA}|v2".encode()).hexdigest()[:8]
    out = f"storage/results/brand_{variant}_{key}.png"
    if not os.path.exists(out):
        tmp = out.replace(".png", ".tmp.png")
        await run_in_threadpool(make_brand_banner, variant, tmp)
        os.replace(tmp, out)
    return FileResponse(out, media_type="image/png")


@router.get("/{job_id}/compare/{index}")
async def get_compare_gif(job_id: str, index: int, fmt: str = "gif"):
    """index번째 시공 전/후 짝의 "밀어 보기" 움짤(GIF, fmt=mp4면 영상) — 네이버 블로그에는 손으로 끄는
    슬라이더를 넣을 수 없어서, 선이 저절로 오가는 GIF로 대신 올린다
    (services/blog_video.make_compare_gif). 짝 규칙은 프론트 lib/blogBlocks.ts와 같다
    (시공 전 i번째 ↔ 시공 후 i번째). 사진 id로 캐시해, 사진이 바뀌면 새로 만든다."""
    quote = load_quote(job_id)
    if quote is None or not quote.get("blog_post"):
        raise HTTPException(status_code=404, detail="블로그 글을 찾을 수 없습니다.")
    photos = quote.get("work_photos", [])
    before = [p for p in photos if p.get("stage") == "before"]
    after = [p for p in photos if p.get("stage") == "after"]
    if index < 0 or index >= min(len(before), len(after)):
        raise HTTPException(status_code=404, detail="비교할 시공 전/후 사진이 없습니다.")
    b, a = before[index], after[index]
    # fmt=mp4: 같은 장면의 영상판 — 네이버가 GIF를 안 받을 때의 확실한 대안([동영상] 버튼).
    # 파일 이름의 v2는 GIF 인코딩 방식을 바꾼 표시(예전 Pillow판 캐시를 다시 쓰지 않게).
    ext, maker, media = ("mp4", make_compare_mp4, "video/mp4") if fmt == "mp4" else ("gif", make_compare_gif, "image/gif")
    out = f"storage/results/{job_id}_compare_v2_{b['id']}_{a['id']}.{ext}"
    if not os.path.exists(out):
        to_path = lambda url: "storage/" + url.split("/static/", 1)[1]  # noqa: E731
        tmp = out.replace(f".{ext}", f".tmp.{ext}")
        await run_in_threadpool(maker, to_path(b["url"]), to_path(a["url"]), tmp)
        os.replace(tmp, out)
    return FileResponse(out, media_type=media)
