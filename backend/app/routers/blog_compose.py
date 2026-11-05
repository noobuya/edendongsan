"""견적 없이 "가진 사진 + (영상) + 제목"만으로 블로그 글을 만드는 API.

[왜 — 2026-11-03 사장님 요청 "가진 사진들과 영상과 결과물과 제목만 넣어서 블로그
작성할 수 있게"]
지금까지 블로그 글은 앱으로 견적을 낸 현장(quote)에만 붙일 수 있었다. 앱 밖에서
찍어 둔 시공 사진·영상으로도 바로 네이버용 글을 만들 수 있게, 견적 대신 가벼운
"블로그 전용" 기록(kind="blog_only")을 같은 저장소(storage/quotes)에 만든다 — 그래서
공개 블로그 목록·상세 화면·네이버 옮기기·영상 만들기를 전부 그대로 재사용한다.
견적 목록과 매출 집계에서는 kind로 걸러낸다(routers/quotes.py, finance.py).

글은 요청 안에서 바로 쓰고(사장님이 정한 제목은 그대로, 메모는 사실 근거로 —
services/blog_writer.py), 영상은 시간이 걸려 응답 뒤 백그라운드에서 처리한다:
올린 영상이 있으면 웹용 MP4로 변환, 없으면 사진으로 자동 생성(services/blog_video.py).
"""
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps, UnidentifiedImageError

from app import business_info
from app.owner_auth import is_owner
from app.quotes_store import load_quote, save_quote, set_blog_post
from app.services.blackboard import stamp_blackboard
from app.services.blog_video import make_blog_video, transcode_uploaded_video
from app.services.blog_writer import generate_blog_post

router = APIRouter(prefix="/api/blog", tags=["blog-compose"])

MAX_PHOTOS = 30
PHOTO_MAX_SIDE = 2560  # 블로그·네이버에 충분하고 저장 용량은 줄인다


def _save_photo(raw: bytes, job_id: str, stage: str, stamp: bool, site_name: str) -> dict:
    try:
        with Image.open(io.BytesIO(raw)) as img:
            # 휴대폰 사진의 EXIF 방향을 실제 픽셀에 반영한다(routers/quotes.py와 같은 이유).
            normalized = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="읽을 수 없는 사진 파일이 있습니다.") from exc
    normalized.thumbnail((PHOTO_MAX_SIDE, PHOTO_MAX_SIDE), Image.LANCZOS)
    if stamp:
        normalized = stamp_blackboard(
            normalized,
            business_name=business_info.business_name(),
            customer_name=site_name,
            stage=stage,
            recorded_at_label=datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y.%m.%d"),
        )
    photo_id = uuid.uuid4().hex[:10]
    path = f"storage/uploads/{job_id}_site_{photo_id}.jpg"
    normalized.save(path, "JPEG", quality=88)
    return {
        "id": photo_id,
        "url": "/" + path.replace("storage/", "static/", 1),
        "stage": stage,
        "caption": "",
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }


def _set_video_status(job_id: str, status: str) -> None:
    quote = load_quote(job_id)
    if quote is not None:
        quote["video_status"] = status
        save_quote(job_id, quote)


def _prepare_video(job_id: str, uploaded_path: str | None) -> None:
    """백그라운드: 올린 영상 변환 또는 사진으로 자동 생성. 실패해도 글은 그대로 남는다."""
    out = f"storage/results/{job_id}_blog_video.mp4"
    tmp = out.replace(".mp4", ".tmp.mp4")
    try:
        if uploaded_path:
            transcode_uploaded_video(uploaded_path, tmp)
        else:
            quote = load_quote(job_id)
            if quote is None:
                return
            make_blog_video(quote, tmp)
        Path(tmp).replace(out)
        _set_video_status(job_id, "ready")
    except Exception as exc:  # noqa: BLE001 - 영상 실패는 글 발행을 막지 않는다
        print(f"[blog_compose] 영상 준비 실패({job_id}): {exc}")
        _set_video_status(job_id, "failed")
    finally:
        if uploaded_path:
            Path(uploaded_path).unlink(missing_ok=True)


@router.post("/compose")
async def compose_blog(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    memo: str = Form(""),
    site_name: str = Form(""),
    stamp: bool = Form(True),
    make_video: bool = Form(True),
    before: list[UploadFile] = File(default=[]),
    progress: list[UploadFile] = File(default=[]),
    after: list[UploadFile] = File(default=[]),
    video: UploadFile | None = File(default=None),
    x_admin_token: str | None = Header(default=None),
):
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 블로그를 만들 수 있어요.")
    title = title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="제목을 입력해 주세요.")
    total = len(before) + len(progress) + len(after)
    if total == 0:
        raise HTTPException(status_code=422, detail="사진을 한 장 이상 넣어 주세요.")
    if total > MAX_PHOTOS:
        raise HTTPException(status_code=422, detail=f"사진은 한 번에 {MAX_PHOTOS}장까지 넣을 수 있어요.")

    job_id = str(uuid.uuid4())
    photos: list[dict] = []
    for stage, files in (("before", before), ("progress", progress), ("after", after)):
        for f in files:
            raw = await f.read()
            if raw:
                photos.append(await run_in_threadpool(_save_photo, raw, job_id, stage, stamp, site_name.strip()))

    uploaded_video: str | None = None
    if video is not None and video.filename:
        suffix = Path(video.filename).suffix.lower() or ".mp4"
        uploaded_video = f"storage/uploads/{job_id}_video_upload{suffix}"
        with open(uploaded_video, "wb") as out:
            while chunk := await video.read(1024 * 1024):
                out.write(chunk)

    now = datetime.now(timezone.utc).isoformat()
    quote = {
        "job_id": job_id,
        "kind": "blog_only",
        "status": "done",
        "customer_name": site_name.strip(),
        "created_at": now,
        "work_photos": photos,
        "estimate": {"line_items": []},
        "blog_title": title,
        "blog_memo": memo.strip(),
        "video_status": "processing" if (uploaded_video or make_video) else None,
    }
    save_quote(job_id, quote)

    try:
        post = await run_in_threadpool(generate_blog_post, quote)
    except Exception as exc:  # noqa: BLE001 - 글 생성 실패해도 사진·제목은 남기고 알린다
        post = {
            "title": title,
            "content": memo.strip() or "시공 사진으로 변화를 확인해 보세요.",
            "hashtags": [],
            "created_at": now,
        }
        set_blog_post(job_id, post)
        if uploaded_video or make_video:
            background_tasks.add_task(_prepare_video, job_id, uploaded_video)
        return {"job_id": job_id, "warning": f"AI 글 작성에 실패해 제목·메모만 넣었어요. 글 화면에서 '글 다시 쓰기'를 눌러 주세요. ({exc})"}

    set_blog_post(job_id, post)
    if uploaded_video or make_video:
        background_tasks.add_task(_prepare_video, job_id, uploaded_video)
    return {"job_id": job_id}
