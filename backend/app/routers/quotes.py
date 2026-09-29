import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.quotes_store import (
    append_work_photo,
    clear_blog_post,
    list_quotes,
    load_quote,
    remove_work_photo,
    set_blog_post,
)
from app.schemas import (
    BlogPost,
    QuoteListResponse,
    QuoteSummary,
    WorkPhoto,
    WorkPhotoStage,
)
from app.services.blog_writer import generate_blog_post

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


def _to_static_url(storage_path: str) -> str:
    return "/" + storage_path.replace("storage/", "static/", 1)


@router.get("", response_model=QuoteListResponse)
async def get_quotes(q: str = ""):
    quotes = list_quotes()
    needle = q.strip().lower()
    summaries = [
        QuoteSummary(
            job_id=quote["job_id"],
            customer_name=quote.get("customer_name") or "고객명 미입력",
            created_at=quote.get("created_at") or "",
            total_cost=(quote.get("estimate") or {}).get("total_cost", 0),
            thumbnail_url=quote.get("rendered_image_url"),
            has_blog=bool(quote.get("blog_post")),
        )
        for quote in quotes
        if quote.get("status") == "done"
        and (not needle or needle in (quote.get("customer_name") or "").lower())
    ]
    return QuoteListResponse(quotes=summaries)


@router.post("/{job_id}/photos", response_model=WorkPhoto)
async def upload_work_photo(
    job_id: str,
    stage: WorkPhotoStage = Form(...),
    caption: str = Form(""),
    photo: UploadFile = File(...),
):
    if load_quote(job_id) is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")

    raw_bytes = await photo.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="사진 파일이 비어 있습니다.")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            normalized = img.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=422,
            detail="사진 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.",
        ) from exc

    photo_id = uuid.uuid4().hex[:10]
    storage_path = f"storage/uploads/{job_id}_site_{photo_id}.jpg"
    normalized.save(storage_path, "JPEG", quality=88)

    entry = {
        "id": photo_id,
        "url": _to_static_url(storage_path),
        "stage": stage,
        "caption": caption,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    if append_work_photo(job_id, entry) is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")
    return WorkPhoto(**entry)


@router.delete("/{job_id}/photos/{photo_id}")
async def delete_work_photo(job_id: str, photo_id: str):
    if remove_work_photo(job_id, photo_id) is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")
    return {"ok": True}


@router.post("/{job_id}/blog", response_model=BlogPost)
async def create_blog_post(job_id: str):
    quote = load_quote(job_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")
    try:
        post = generate_blog_post(quote)
    except Exception as exc:  # noqa: BLE001 - Gemini 실패/키 미설정 등을 그대로 사용자에게 전달
        raise HTTPException(status_code=502, detail=f"블로그 글 생성에 실패했습니다: {exc}") from exc
    set_blog_post(job_id, post)
    return BlogPost(**post)


@router.delete("/{job_id}/blog")
async def delete_blog_post(job_id: str):
    if load_quote(job_id) is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")
    clear_blog_post(job_id)
    return {"ok": True}
