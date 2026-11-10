"""실물 견본 책자 스캔 API — services/swatch_scan.py 참고.

쪽 사진을 올리면 Gemini Vision으로 품번 칩들을 찾아 자동으로 잘라 저장하고,
사장님이 결과를 확인·수정·삭제할 수 있게 한다."""
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import get_settings
from app.owner_auth import is_owner
from app.services import swatch_scan

router = APIRouter(prefix="/api/swatch-scan", tags=["swatch-scan"])


@router.get("")
async def list_swatch_scans():
    """공개 핑 — /colors가 이 목록을 그대로 품번 선택지로 쓴다."""
    return swatch_scan.list_entries()


@router.get("/photo/{filename}")
async def get_swatch_scan_photo(filename: str):
    path = Path(get_settings().storage_dir) / "swatch_scan_photos" / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=300"})


@router.post("/{brand}")
async def scan_swatch_pages(
    brand: str,
    images: list[UploadFile] = File(...),
    x_admin_token: str | None = Header(default=None),
):
    """쪽 사진을 한 장 또는 여러 장(책자 전체) 한 번에 올려 스캔한다. 한 쪽이
    실패해도 나머지 쪽은 계속 처리한다 — 100쪽짜리 책자 올리다 한 장 때문에
    전부 멈추면 안 되기 때문이다."""
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 스캔할 수 있어요.")

    found: list[dict] = []
    errors: list[str] = []
    for idx, image in enumerate(images):
        raw = await image.read()
        label = f"{brand} {image.filename or f'p{idx + 1}'}"
        try:
            found.extend(swatch_scan.scan_page(raw, brand, source_label=label))
        except Exception as exc:  # noqa: BLE001 — 한 쪽 실패는 기록만 하고 계속
            errors.append(f"{label}: {exc}")

    return {"found": found, "errors": errors, "total": len(swatch_scan.list_entries())}


class UpdateBody(BaseModel):
    code: str | None = None
    name: str | None = None
    brand: str | None = None


@router.patch("/{entry_id}")
async def update_swatch_scan(entry_id: str, body: UpdateBody, x_admin_token: str | None = Header(default=None)):
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 수정할 수 있어요.")
    return swatch_scan.update_entry(entry_id, code=body.code, name=body.name, brand=body.brand)


@router.delete("/{entry_id}")
async def delete_swatch_scan(entry_id: str, x_admin_token: str | None = Header(default=None)):
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 지울 수 있어요.")
    return swatch_scan.delete_entry(entry_id)
