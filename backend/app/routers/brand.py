"""업체 로고·명함 이미지 — 사장님이 앱에서 직접 올리고 바꾼다.

[왜 — 2026-11-03 사장님 요청 "블로그 메인에 명함, 로고를 잘 보이게, 앱 첫 화면 사진의
에덴인테리어 글자 대신 로고와 명함"]
로고·명함은 사장님 PC/휴대폰에만 있어서, 서버로 옮길 방법이 따로 없으면 반영할 수가
없었다. 사장님 전용 화면(/admin/brand)에서 올리면 storage/brand에 저장되고, 블로그
상단·네이버 배너·앱 첫 화면이 이 파일을 쓴다. 바꾸면 주소의 v(수정 시각)가 바뀌어
브라우저가 예전 그림을 보여 주지 않는다.
"""
import io
import os
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import get_settings
from app.owner_auth import is_owner

router = APIRouter(prefix="/api/brand", tags=["brand"])

KINDS = {"logo": "로고", "card": "명함"}
MAX_SIDE = 2000


def brand_dir() -> Path:
    d = Path(get_settings().storage_dir) / "brand"
    d.mkdir(parents=True, exist_ok=True)
    return d


def brand_path(kind: str) -> Path | None:
    p = brand_dir() / f"{kind}.png"
    return p if p.exists() else None


def brand_info() -> dict:
    out = {}
    for kind in KINDS:
        p = brand_path(kind)
        out[kind] = f"/api/brand/{kind}?v={int(p.stat().st_mtime)}" if p else None
    return out


@router.get("")
async def get_brand():
    return brand_info()


@router.get("/{kind}")
async def get_brand_image(kind: str):
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="없는 항목입니다.")
    p = brand_path(kind)
    if p is None:
        raise HTTPException(status_code=404, detail=f"{KINDS[kind]} 이미지가 아직 없습니다.")
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})


@router.post("/{kind}")
async def upload_brand_image(kind: str, image: UploadFile = File(...), x_admin_token: str | None = Header(default=None)):
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 바꿀 수 있어요.")
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="없는 항목입니다.")
    raw = await image.read()
    try:
        with Image.open(io.BytesIO(raw)) as img:
            # 로고의 투명 배경을 살리려고 RGBA PNG로 저장한다. 휴대폰 사진 방향(EXIF)은 반영.
            normalized = ImageOps.exif_transpose(img).convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="사진 파일을 읽을 수 없습니다.") from exc
    normalized.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    tmp = brand_dir() / f"{kind}.tmp.png"
    normalized.save(tmp, "PNG", optimize=True)
    os.replace(tmp, brand_dir() / f"{kind}.png")
    return brand_info()
