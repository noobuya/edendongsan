"""개인 작업 일지 API. 글쓴이는 수강생 코드(X-Access-Code)로 확인한다.
읽기·수정·삭제는 본인(코드로 확인된 이름이 글쓴이와 같을 때) 또는 사장님
토큰(X-Admin-Token)만 할 수 있다 — 다른 수강생은 절대 못 본다."""
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from app import journal_store as store
from app.owner_auth import is_owner
from app.routers.automation import resolve_owner

router = APIRouter(prefix="/api/journal", tags=["journal"])


def _to_static_url(storage_path: str) -> str:
    return "/" + storage_path.replace("storage/", "static/", 1)


def _require_owner(x_access_code: str | None) -> str:
    owner = resolve_owner(x_access_code)
    if owner is None:
        raise HTTPException(401, "수강생 코드가 올바르지 않아요.")
    return owner


def _load_with_access(
    entry_id: str, x_access_code: str | None, x_admin_token: str | None, *, author_only: bool = False
) -> dict:
    """글을 찾아 접근 권한까지 확인한다. author_only=True면 본인만(관리자도 안 됨) —
    사진 추가처럼 글쓴이만 해야 하는 동작에 쓴다."""
    entry = store.get_entry(entry_id)
    if entry is None:
        raise HTTPException(404, "일지를 찾을 수 없어요.")
    owner = resolve_owner(x_access_code)
    if owner == entry["owner"]:
        return entry
    if not author_only and is_owner(x_admin_token):
        return entry
    raise HTTPException(403, "본인 글만 볼 수 있어요.")


class EntryIn(BaseModel):
    title: str = Field(min_length=1, max_length=60)
    content: str = Field(default="", max_length=4000)


@router.post("")
async def create_entry(req: EntryIn, x_access_code: str | None = Header(default=None)):
    owner = _require_owner(x_access_code)
    return store.create_entry(owner, req.title.strip(), req.content.strip())


@router.get("")
async def list_entries(
    x_access_code: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
    owner: str = "",
):
    if is_owner(x_admin_token):
        entries = store.list_all()
        return [e for e in entries if e["owner"] == owner] if owner else entries
    return store.list_for(_require_owner(x_access_code))


@router.get("/{entry_id}")
async def get_entry(
    entry_id: str,
    x_access_code: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
):
    return _load_with_access(entry_id, x_access_code, x_admin_token)


@router.patch("/{entry_id}")
async def update_entry(
    entry_id: str,
    req: EntryIn,
    x_access_code: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
):
    _load_with_access(entry_id, x_access_code, x_admin_token)
    updated = store.update_entry(entry_id, req.title.strip(), req.content.strip())
    if updated is None:
        raise HTTPException(404, "일지를 찾을 수 없어요.")
    return updated


@router.delete("/{entry_id}")
async def delete_entry(
    entry_id: str,
    x_access_code: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
):
    _load_with_access(entry_id, x_access_code, x_admin_token)
    store.delete_entry(entry_id)
    return {"ok": True}


@router.post("/{entry_id}/photos")
async def upload_photo(
    entry_id: str,
    caption: str = Form(""),
    photo: UploadFile = File(...),
    x_access_code: str | None = Header(default=None),
):
    _load_with_access(entry_id, x_access_code, None, author_only=True)

    raw_bytes = await photo.read()
    if not raw_bytes:
        raise HTTPException(422, "사진 파일이 비어 있습니다.")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            normalized = img.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            422, "사진 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다."
        ) from exc

    photo_id = uuid.uuid4().hex[:10]
    storage_path = f"storage/uploads/journal_{entry_id}_{photo_id}.jpg"
    normalized.save(storage_path, "JPEG", quality=88)

    entry_photo = {
        "id": photo_id,
        "url": _to_static_url(storage_path),
        "caption": caption,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    updated = store.append_photo(entry_id, entry_photo)
    if updated is None:
        raise HTTPException(404, "일지를 찾을 수 없어요.")
    return updated


@router.delete("/{entry_id}/photos/{photo_id}")
async def delete_photo(entry_id: str, photo_id: str, x_access_code: str | None = Header(default=None)):
    _load_with_access(entry_id, x_access_code, None, author_only=True)
    updated = store.remove_photo(entry_id, photo_id)
    if updated is None:
        raise HTTPException(404, "일지를 찾을 수 없어요.")
    return updated
