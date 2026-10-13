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

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PushToken
from app.owner_auth import is_owner
from app.proposal_store import delete_proposal, list_proposals, load_proposal, mark_first_viewed, save_proposal
from app.quotes_store import load_quote
from app.schemas import Proposal, ProposalFeedbackRequest, ProposalListResponse, ProposalPublicResponse
from app.services.proposal_writer import adjust_brightness, generate_copy, generate_crops, regenerate_copy
from app.services.push import send_push

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
            # quotes.py의 upload_work_photo와 같은 이유 — EXIF Orientation을 먼저
            # 픽셀에 적용해야 가로/세로로 찍은 사진이 전부 정방향으로 저장된다.
            normalized = ImageOps.exif_transpose(img).convert("RGB")
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
    before_image_url = None
    estimate_snapshot = None
    site_conditions_snapshot = None
    if job_id_clean:
        quote = load_quote(job_id_clean)
        if quote:
            sales_pitch = (quote.get("estimate") or {}).get("sales_pitch", "") or ""
            # 풀패키지 자료는 지금 이 시점 값을 그대로 복사해 둔다(참조 아님) — 나중에
            # 견적을 고쳐도 이미 만든 제안서·발행된 공유 링크는 바뀌지 않아야 한다.
            before_image_url = quote.get("original_image_url")
            estimate_snapshot = quote.get("estimate")
            site_conditions_snapshot = quote.get("site_conditions")

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
        "before_image_url": before_image_url,
        "estimate": estimate_snapshot,
        "site_conditions": site_conditions_snapshot,
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
async def get_public_proposal(proposal_id: str, db: Session = Depends(get_db)):
    """카톡·문자로 보내는 공개 링크가 보는 엔드포인트 — 인증 없음, published만 노출.

    [첫 열람 시 사장님에게 푸시] 고객이 가장 관심이 높은 순간이 바로 이 링크를
    처음 여는 순간이라, 그때 바로 전화를 걸 수 있게 사장님 전 기기에 알린다.
    두 번째부터는(다시 열어봐도) mark_first_viewed가 False를 돌려주므로 조용히
    넘어간다 — 고객이 같은 링크를 여러 번 열 때마다 사장님 폰이 울리면 안 된다."""
    data = load_proposal(proposal_id)
    if data is None or data["status"] != "published":
        raise HTTPException(status_code=404, detail="제안서를 찾을 수 없습니다.")
    if mark_first_viewed(proposal_id, datetime.now(timezone.utc).isoformat()):
        tokens = [t.token for t in db.query(PushToken).filter(PushToken.is_owner.is_(True))]
        send_push(
            tokens,
            "고객이 제안서를 확인했어요!",
            f"지금이 연락하기 좋은 타이밍이에요 — {data.get('headline', '')}",
            data={"type": "proposal_viewed", "proposal_id": proposal_id},
        )
    return ProposalPublicResponse(**data)
