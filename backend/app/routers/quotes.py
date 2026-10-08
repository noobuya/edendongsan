import io
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.business_info import BUSINESS_NAME
from app.owner_auth import is_owner
from app.services.blackboard import stamp_blackboard
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


def _require_owner(x_admin_token: str | None = Header(default=None)) -> None:
    """견적서 목록·현장 사진·블로그 글은 고객 이름·금액이 들어 있는 사장님 전용 자료다.
    저장된 견적서를 누구나(학생 기기 포함) 인증 없이 조회·수정할 수 있던 문제를 막는다."""
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 쓸 수 있어요.")


router = APIRouter(prefix="/api/quotes", tags=["quotes"], dependencies=[Depends(_require_owner)])


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
    quote = load_quote(job_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")

    raw_bytes = await photo.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="사진 파일이 비어 있습니다.")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            normalized = img.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(
            status_code=422,
            detail="사진 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.",
        ) from exc

    # 전자흑판 — 현장명·촬영일·업체명·단계를 사진에 각인한다(일본 蔵衛門 등 공사사진
    # 앱의 핵심 기능). 이 사진이 그대로 시공후기 블로그의 비포/애프터 증거가 된다.
    recorded_at_label = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y.%m.%d")
    stamped = stamp_blackboard(
        normalized,
        business_name=BUSINESS_NAME,
        customer_name=quote.get("customer_name") or "",
        stage=stage,
        recorded_at_label=recorded_at_label,
    )

    photo_id = uuid.uuid4().hex[:10]
    storage_path = f"storage/uploads/{job_id}_site_{photo_id}.jpg"
    stamped.save(storage_path, "JPEG", quality=88)

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
