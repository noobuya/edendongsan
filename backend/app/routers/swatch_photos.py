"""실물 견본 사진 — 사장님이 보닥/KCC 샘플북을 직접 찍어 올리면, 색상 상담
화면(/colors)에서 근사 hex 색 블록 대신 그 실제 사진을 보여준다.

[왜 — 2026-11-10 사장님 요청 "견본품 사진을 다 찍어서 올리면 학습해서
보여줄 수 있어?"] catalog.py/patternSwatches.ts의 color_hex는 "공식 사이트가
hex를 공개하지 않아 컬러명을 보고 근사치로 잡은 값"이라고 주석에 명시돼
있다 — 실제 샘플북과 미묘하게 다를 수 있다. 사장님이 실물을 찍어 올리면
그 사진을 그대로 보여줘, 현장에서 고객에게 "이 색이에요"라고 할 때 approx
색이 아니라 실제로 발주할 그 샘플 사진을 보여줄 수 있게 한다.

catalog.PATTERNS에 있는 품번(현재 24개)에만 올릴 수 있다 — 거기 없는
pattern_id는 애초에 색 선택 화면에 등장하지 않으므로 사진을 올려도 쓰일
곳이 없다."""
import io
import os
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from app.catalog import PATTERNS
from app.config import get_settings
from app.owner_auth import is_owner

router = APIRouter(prefix="/api/swatch-photos", tags=["swatch-photos"])
MAX_SIDE = 1200


def _dir() -> Path:
    d = Path(get_settings().storage_dir) / "swatch_photos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(pattern_id: str) -> Path:
    return _dir() / f"{pattern_id}.jpg"


def _listing() -> dict:
    out: dict[str, str] = {}
    for pattern_id in PATTERNS:
        p = _path(pattern_id)
        if p.exists():
            out[pattern_id] = f"/api/swatch-photos/{pattern_id}?v={int(p.stat().st_mtime)}"
    return out


@router.get("")
async def list_swatch_photos():
    """업로드된 품번만 {pattern_id: url}로 돌려준다 — 없는 품번은 프론트가
    approxHex 색 블록으로 그대로 대체해 보여준다(화면이 비는 일은 없다)."""
    return _listing()


@router.get("/{pattern_id}")
async def get_swatch_photo(pattern_id: str):
    p = _path(pattern_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="아직 올린 사진이 없습니다.")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=300"})


@router.post("/{pattern_id}")
async def upload_swatch_photo(
    pattern_id: str, image: UploadFile = File(...), x_admin_token: str | None = Header(default=None)
):
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 올릴 수 있어요.")
    if pattern_id not in PATTERNS:
        raise HTTPException(status_code=404, detail="없는 품번입니다.")
    raw = await image.read()
    try:
        with Image.open(io.BytesIO(raw)) as img:
            normalized = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="사진 파일을 읽을 수 없습니다.") from exc
    normalized.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    tmp = _dir() / f"{pattern_id}.tmp.jpg"
    normalized.save(tmp, "JPEG", quality=88, optimize=True)
    os.replace(tmp, _path(pattern_id))
    return _listing()


@router.delete("/{pattern_id}")
async def delete_swatch_photo(pattern_id: str, x_admin_token: str | None = Header(default=None)):
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 지울 수 있어요.")
    p = _path(pattern_id)
    if p.exists():
        p.unlink()
    return _listing()
