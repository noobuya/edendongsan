"""업체 로고·명함·대표 사진 — 사장님이 앱에서 직접 올리고 바꾼다.

[왜 — 2026-11-03 사장님 요청 "블로그 메인에 명함, 로고를 잘 보이게, 앱 첫 화면 사진의
에덴인테리어 글자 대신 로고와 명함"]
로고·명함은 사장님 PC/휴대폰에만 있어서, 서버로 옮길 방법이 따로 없으면 반영할 수가
없었다. 사장님 전용 화면(/admin/brand)에서 올리면 storage/brand에 저장되고, 블로그
상단·네이버 배너·앱 첫 화면이 이 파일을 쓴다. 바꾸면 주소의 v(수정 시각)가 바뀌어
브라우저가 예전 그림을 보여 주지 않는다.

[왜 — 2026-11-05 사장님 요청 "앱 안의 전체 사진을 (관리자 화면에서) 바꿀 수 있게"]
앱 첫 화면·견적 화면 맨 위의 대표 사진(components/BrandHero.tsx)은 그동안
frontend/public/images/eden_main.jpg로 코드에 박혀 있어, 바꾸려면 파일을 덮어쓰고
다시 빌드·배포해야 했다. "hero"를 로고·명함과 같은 종류로 추가해 같은 화면
(/admin/brand)에서 사진 한 장으로 바로 바꿀 수 있게 한다 — 새 코드를 더 만들
필요 없이 기존 로고·명함 업로드 로직을 그대로 탄다.

[왜 — 2026-11-05 사장님 요청 "상호명·전화번호를 설정에서 바꾸고, 대표 사진도
AI로 새로 만들 수 있게"]
상호명·전화번호는 이제 app/business_info.py의 override 저장소에서 읽고 쓴다
(get/put_business_info). 대표 사진은 사장님이 직접 올리는 것과 별개로,
services/hero_generator.py가 AI로 새로 만들어 같은 hero.png 자리에 채우는
경로(POST /hero/generate)도 추가했다 — 상호명을 바꿨다고 자동으로 사진까지
다시 만들지는 않는다(API 비용이 드는 작업이라 매번 저절로 돌리면 안 된다).
대신 프론트가 상호명 저장 직후 "대표 사진도 새로 만들어 주세요"라고 안내만
하고, 실제 생성은 사장님이 버튼을 눌러야 시작된다."""
import io
import os
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from app import business_info
from app.config import get_settings
from app.owner_auth import is_owner
from app.schemas import BusinessInfoResponse, BusinessInfoUpdateRequest
from app.services.hero_generator import generate_hero_image

router = APIRouter(prefix="/api/brand", tags=["brand"])

KINDS = {"logo": "로고", "card": "명함", "hero": "대표 사진"}
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


# [왜 이 구체적인 경로들이 /{kind}보다 먼저 와야 하는가] FastAPI는 등록 순서대로
# 매치한다. GET /{kind}가 먼저 있으면 GET /business-info가 kind="business-info"로
# 잘못 잡혀 404("없는 항목입니다")가 난다 — 실제로 이 순서로 한 번 썼다가 겪었다.
@router.post("/hero/generate")
async def generate_hero(x_admin_token: str | None = Header(default=None)):
    """AI로 대표 사진(배경)을 새로 만들어 hero 자리에 채운다 — 지금 설정된
    상호명·전화번호가 그 위에 정확하게 얹힌다(services/hero_generator.py)."""
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 만들 수 있어요.")
    tmp = brand_dir() / "hero.tmp.png"
    try:
        await run_in_threadpool(generate_hero_image, str(tmp))
    except Exception as exc:  # noqa: BLE001 - Gemini 실패/키 미설정 등을 그대로 사용자에게
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    os.replace(tmp, brand_dir() / "hero.png")
    return brand_info()


@router.get("/business-info", response_model=BusinessInfoResponse)
async def get_business_info():
    return BusinessInfoResponse(**business_info.effective())


@router.put("/business-info", response_model=BusinessInfoResponse)
async def put_business_info(payload: BusinessInfoUpdateRequest, x_admin_token: str | None = Header(default=None)):
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 바꿀 수 있어요.")
    values = {k: v.strip() for k, v in payload.model_dump().items() if v is not None}
    if "business_name" in values and not values["business_name"]:
        raise HTTPException(status_code=422, detail="상호명은 비워둘 수 없습니다.")
    if "phone" in values and not values["phone"]:
        raise HTTPException(status_code=422, detail="전화번호는 비워둘 수 없습니다.")
    return BusinessInfoResponse(**business_info.save_overrides(values))


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
