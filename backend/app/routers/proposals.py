"""AI 제안서(고객 발송용 상세페이지) — 사진 한 장으로 와이드컷·디테일컷·영업
카피를 자동 생성하고, 기공이 확인·피드백한 뒤 공개 링크로 발행한다.

생성·피드백·발행·목록·삭제는 사장님 전용(quotes.py와 같은 X-Admin-Token 방식),
발행된 제안서 조회 한 건만 공개 라우터로 분리한다(blog.py가 quotes.py와
분리된 것과 같은 이유 — 공개 조회는 인증 없이 열려야 하므로 같은 라우터에
dependencies를 걸 수 없다)."""
import io
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.owner_auth import is_owner
from app.proposal_store import delete_proposal, list_proposals, load_proposal, save_proposal
from app.quotes_store import load_quote
from app.schemas import Proposal, ProposalFeedbackRequest, ProposalListResponse, ProposalPublicResponse
from app.services.proposal_writer import adjust_brightness, generate_copy, generate_crops, regenerate_copy

BRIGHTNESS_FACTORS = {"brighter": 1.25, "darker": 0.8}


def _require_owner(x_admin_token: str | None = Header(default=None)) -> None:
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 쓸 수 있어요.")


router = APIRouter(prefix="/api/proposals", tags=["proposals"])
public_router = APIRouter(prefix="/api/proposals", tags=["proposals-public"])


def _to_static_url(storage_path: str) -> str:
    return "/" + storage_path.replace("storage/", "static/", 1)


@router.post("", response_model=Proposal)
async def create_proposal(
    photo: UploadFile = File(...),
    job_id: str = Form(""),
    x_admin_token: str | None = Header(default=None),
):
    _require_owner(x_admin_token)

    raw_bytes = await photo.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="사진 파일이 비어 있습니다.")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            normalized = img.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(
            status_code=422, detail="사진 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다."
        ) from exc

    proposal_id = uuid.uuid4().hex
    source_path = f"storage/uploads/{proposal_id}_proposal_source.jpg"
    os.makedirs("storage/uploads", exist_ok=True)
    normalized.save(source_path, "JPEG", quality=95)

    try:
        crops = generate_crops(source_path, proposal_id)
    except Exception as exc:  # noqa: BLE001 - 사진 저장은 끝났으니 사용자에게 실패를 그대로 알린다
        raise HTTPException(status_code=502, detail=f"이미지 생성에 실패했습니다: {exc}") from exc

    job_id_clean = job_id.strip() or None
    sales_pitch = ""
    if job_id_clean:
        quote = load_quote(job_id_clean)
        if quote:
            sales_pitch = (quote.get("estimate") or {}).get("sales_pitch", "") or ""

    try:
        copy = generate_copy(source_path, sales_pitch)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"카피 생성에 실패했습니다: {exc}") from exc

    data = {
        "id": proposal_id,
        "status": "review",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "published_at": None,
        "job_id": job_id_clean,
        "source_image_url": _to_static_url(source_path),
        "wide_image_url": crops["wide_image_url"],
        "detail_image_url": crops["detail_image_url"],
        "headline": copy["headline"],
        "body": copy["body"],
    }
    save_proposal(proposal_id, data)
    return Proposal(**data)


@router.get("", response_model=ProposalListResponse)
async def get_proposals(x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    return ProposalListResponse(proposals=[Proposal(**p) for p in list_proposals()])


@router.get("/{proposal_id}", response_model=Proposal)
async def get_proposal(proposal_id: str, x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    data = load_proposal(proposal_id)
    if data is None:
        raise HTTPException(status_code=404, detail="제안서를 찾을 수 없습니다.")
    return Proposal(**data)


@router.post("/{proposal_id}/feedback", response_model=Proposal)
async def send_feedback(
    proposal_id: str,
    payload: ProposalFeedbackRequest,
    x_admin_token: str | None = Header(default=None),
):
    """선택한 부분(이미지/카피)만 다시 만든다 — 전체 재생성이 아니다."""
    _require_owner(x_admin_token)
    data = load_proposal(proposal_id)
    if data is None:
        raise HTTPException(status_code=404, detail="제안서를 찾을 수 없습니다.")
    if data["status"] == "published":
        raise HTTPException(status_code=409, detail="이미 발행된 제안서는 수정할 수 없습니다.")

    if payload.target == "detail_image":
        if payload.action not in ("brighter", "darker"):
            raise HTTPException(status_code=422, detail="이미지는 '더 밝게'/'더 어둡게'만 지원합니다.")
        factor = BRIGHTNESS_FACTORS[payload.action]
        data["detail_image_url"] = adjust_brightness(data["detail_image_url"], factor, proposal_id, "detail")
    else:
        if payload.action == "shorter":
            feedback = "본문을 지금보다 더 짧게, 헤드라인도 더 간결하게 줄여줘."
        elif payload.action == "longer":
            feedback = "본문을 조금 더 자세하게 늘려줘(단, 3문장을 넘기지는 마)."
        elif payload.action == "custom":
            if not payload.note.strip():
                raise HTTPException(status_code=422, detail="피드백 내용을 입력해 주세요.")
            feedback = payload.note.strip()
        else:
            raise HTTPException(status_code=422, detail="카피는 '더 짧게'/'더 길게'/직접 입력만 지원합니다.")
        try:
            new_copy = regenerate_copy({"headline": data["headline"], "body": data["body"]}, feedback)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"카피 재생성에 실패했습니다: {exc}") from exc
        data["headline"] = new_copy["headline"]
        data["body"] = new_copy["body"]

    save_proposal(proposal_id, data)
    return Proposal(**data)


@router.post("/{proposal_id}/publish", response_model=Proposal)
async def publish_proposal(proposal_id: str, x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    data = load_proposal(proposal_id)
    if data is None:
        raise HTTPException(status_code=404, detail="제안서를 찾을 수 없습니다.")
    data["status"] = "published"
    data["published_at"] = datetime.now(timezone.utc).isoformat()
    save_proposal(proposal_id, data)
    return Proposal(**data)


@router.delete("/{proposal_id}")
async def remove_proposal(proposal_id: str, x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    if not delete_proposal(proposal_id):
        raise HTTPException(status_code=404, detail="제안서를 찾을 수 없습니다.")
    return {"ok": True}


@public_router.get("/{proposal_id}/public", response_model=ProposalPublicResponse)
async def get_public_proposal(proposal_id: str):
    """카톡·문자로 보내는 공개 링크가 보는 엔드포인트 — 인증 없음, published만 노출."""
    data = load_proposal(proposal_id)
    if data is None or data["status"] != "published":
        raise HTTPException(status_code=404, detail="제안서를 찾을 수 없습니다.")
    return ProposalPublicResponse(**data)
