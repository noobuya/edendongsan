"""AI 가상시공 비교판 — 사장님이 올린 시공전 사진들과, 외부 AI(Gemini 등)로
미리 만들어 둔 시공후 옵션 사진들을 한 장의 제안서 이미지(격자 비교판)로
합성하고, 원하면 그중 한 짝을 전/후 비교 영상(움짤/MP4)으로도 만든다.
완성본은 사장님이 직접 카톡·문자로 공유하거나(이미지·영상 파일을 받아
SendResultToCustomer와 같은 방식으로), 고객 전용 링크로 발행해(/publish)
보낼 수 있다(둘 다 지원 — 사장님 요청).

생성·조회·발행·삭제는 사장님 전용(proposals.py와 같은 X-Admin-Token 방식),
발행된 비교판 조회와 비교 영상 생성만 공개(인증 없음) — 영상 쪽은
routers/jobs.py의 /compare, routers/blog.py의 /compare/{index}와 같은
이유(주소 자체가 board_id+사진 id를 알아야 접근 가능한 비공개 정보)."""
import io
import json
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from app.comparison_store import delete_board, list_boards, load_board, save_board
from app.owner_auth import is_owner
from app.services.blog_video import make_compare_gif, make_compare_mp4
from app.services.comparison_board import ComparisonAreaData, ComparisonOptionData, compose_board_image

router = APIRouter(prefix="/api/comparison", tags=["comparison"])
public_router = APIRouter(prefix="/api/comparison", tags=["comparison-public"])

MAX_PHOTOS = 40


class OptionInput(BaseModel):
    label: str
    caption: str = ""
    price_note: str = ""
    # 비교판 이미지·공개 페이지에 "필름: OOO"로 표시되는 실제 자재명/품번
    # (사장님 요청: "모든 부위에 필름이름을 밑에 부수기재로 넣어줘").
    film_name: str = ""


class AreaInput(BaseModel):
    label: str
    options: list[OptionInput] = Field(default_factory=list)


def _require_owner(x_admin_token: str | None) -> None:
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 쓸 수 있어요.")


def _to_static_url(storage_path: str) -> str:
    return "/" + storage_path.replace("storage/", "static/", 1)


def _static_url_to_path(url: str) -> str:
    return "storage/" + url.split("/static/", 1)[1] if "/static/" in url else url


def _save_photo(raw: bytes, board_id: str, photo_id: str) -> str:
    try:
        with Image.open(io.BytesIO(raw)) as img:
            normalized = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail=f"읽을 수 없는 사진 파일이 있습니다({photo_id}).") from exc
    normalized.thumbnail((2000, 2000), Image.LANCZOS)
    os.makedirs("storage/uploads", exist_ok=True)
    path = f"storage/uploads/{board_id}_{photo_id}.jpg"
    normalized.save(path, "JPEG", quality=90)
    return path


@router.post("")
async def create_board(
    title: str = Form(...),
    price_note: str = Form(""),
    layout: str = Form(...),
    photos: list[UploadFile] = File(...),
    x_admin_token: str | None = Header(default=None),
):
    _require_owner(x_admin_token)
    title = title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="제목을 입력해 주세요.")

    try:
        areas_input = [AreaInput(**a) for a in json.loads(layout)]
    except Exception as exc:  # noqa: BLE001 - 프런트가 보낸 JSON이 깨진 경우를 그대로 알린다
        raise HTTPException(status_code=422, detail=f"레이아웃 정보를 읽을 수 없습니다: {exc}") from exc
    if not areas_input:
        raise HTTPException(status_code=422, detail="비교할 부위를 한 개 이상 추가해 주세요.")

    expected = sum(1 + len(a.options) for a in areas_input)
    if expected > MAX_PHOTOS:
        raise HTTPException(status_code=422, detail=f"사진은 한 번에 {MAX_PHOTOS}장까지 넣을 수 있어요.")
    if len(photos) != expected:
        raise HTTPException(
            status_code=422, detail=f"사진 수({len(photos)}장)가 레이아웃({expected}장)과 맞지 않습니다."
        )

    board_id = uuid.uuid4().hex
    photo_iter = iter(photos)
    areas_data: list[dict] = []
    compose_areas: list[ComparisonAreaData] = []

    for i, area in enumerate(areas_input):
        before_raw = await next(photo_iter).read()
        if not before_raw:
            raise HTTPException(status_code=422, detail=f"'{area.label}' 시공전 사진이 비어 있습니다.")
        before_id = f"area{i}_before"
        before_path = await run_in_threadpool(_save_photo, before_raw, board_id, before_id)

        options_data = []
        compose_options = []
        for j, opt in enumerate(area.options):
            opt_raw = await next(photo_iter).read()
            if not opt_raw:
                raise HTTPException(status_code=422, detail=f"'{area.label} - {opt.label}' 사진이 비어 있습니다.")
            opt_id = f"area{i}_opt{j}"
            opt_path = await run_in_threadpool(_save_photo, opt_raw, board_id, opt_id)
            options_data.append(
                {
                    "id": opt_id,
                    "label": opt.label,
                    "caption": opt.caption,
                    "price_note": opt.price_note,
                    "film_name": opt.film_name,
                    "photo": {"id": opt_id, "url": _to_static_url(opt_path)},
                }
            )
            compose_options.append(
                ComparisonOptionData(label=opt.label, caption=opt.caption, film_name=opt.film_name, photo_path=opt_path)
            )

        areas_data.append(
            {
                "label": area.label,
                "before_photo": {"id": before_id, "url": _to_static_url(before_path)},
                "options": options_data,
            }
        )
        compose_areas.append(ComparisonAreaData(label=area.label, before_path=before_path, options=compose_options))

    image_path = f"storage/results/{board_id}_board.jpg"
    try:
        await run_in_threadpool(compose_board_image, title, compose_areas, price_note.strip(), image_path)
    except Exception as exc:  # noqa: BLE001 - 사진은 이미 저장됐으니 실패를 그대로 알린다
        raise HTTPException(status_code=502, detail=f"비교판 이미지를 만들지 못했습니다: {exc}") from exc

    now = datetime.now(timezone.utc).isoformat()
    data = {
        "id": board_id,
        "status": "draft",
        "created_at": now,
        "published_at": None,
        "title": title,
        "price_note": price_note.strip(),
        "areas": areas_data,
        "image_url": _to_static_url(image_path),
    }
    save_board(board_id, data)
    return data


@router.get("")
async def get_boards(x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    return {"boards": list_boards()}


@router.get("/{board_id}")
async def get_board(board_id: str, x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    data = load_board(board_id)
    if data is None:
        raise HTTPException(status_code=404, detail="비교판을 찾을 수 없습니다.")
    return data


@router.delete("/{board_id}")
async def remove_board(board_id: str, x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    if not delete_board(board_id):
        raise HTTPException(status_code=404, detail="비교판을 찾을 수 없습니다.")
    return {"ok": True}


@router.post("/{board_id}/publish")
async def publish_board(board_id: str, x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    data = load_board(board_id)
    if data is None:
        raise HTTPException(status_code=404, detail="비교판을 찾을 수 없습니다.")
    data["status"] = "published"
    data["published_at"] = datetime.now(timezone.utc).isoformat()
    save_board(board_id, data)
    return data


def _find_photo_path(data: dict, photo_id: str) -> str | None:
    for area in data["areas"]:
        if area["before_photo"]["id"] == photo_id:
            return _static_url_to_path(area["before_photo"]["url"])
        for opt in area["options"]:
            if opt["photo"]["id"] == photo_id:
                return _static_url_to_path(opt["photo"]["url"])
    return None


@router.get("/{board_id}/video")
async def get_board_compare_video(board_id: str, before: str, after: str, fmt: str = "gif"):
    """지정한 두 사진(photo id)으로 "밀어 보기" 비교 움짤(GIF, fmt=mp4면 영상)을
    만든다 — services/blog_video.make_compare_gif/mp4를 그대로 재사용한다."""
    data = load_board(board_id)
    if data is None:
        raise HTTPException(status_code=404, detail="비교판을 찾을 수 없습니다.")
    before_path = _find_photo_path(data, before)
    after_path = _find_photo_path(data, after)
    if not before_path or not after_path:
        raise HTTPException(status_code=404, detail="비교할 사진을 찾을 수 없습니다.")

    ext, maker, media = (
        ("mp4", make_compare_mp4, "video/mp4") if fmt == "mp4" else ("gif", make_compare_gif, "image/gif")
    )
    out = f"storage/results/{board_id}_cmp_{before}_{after}.{ext}"
    if not os.path.exists(out):
        tmp = out.replace(f".{ext}", f".tmp.{ext}")
        await run_in_threadpool(maker, before_path, after_path, tmp)
        os.replace(tmp, out)
    return FileResponse(out, media_type=media)


@public_router.get("/{board_id}/public")
async def get_public_board(board_id: str):
    data = load_board(board_id)
    if data is None or data["status"] != "published":
        raise HTTPException(status_code=404, detail="비교판을 찾을 수 없습니다.")
    return data
