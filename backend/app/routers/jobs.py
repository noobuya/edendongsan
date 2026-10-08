import io
import json
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, File, Form, Header, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.catalog import PATTERNS
from app.jobs_store import JOBS
from app.catalog import manual_base_prompt
from app.owner_auth import is_owner
from app.pipeline import (
    _quote_snapshot,
    _to_static_url,
    run_illustration_edit,
    run_inpaint_edit,
    run_remask,
)
from app.quotes_store import clear_signature, load_quote, save_quote, set_signature
from app.schemas import (
    IllustrationRequest,
    InpaintAcceptedResponse,
    InpaintRequest,
    JobStatusResponse,
    SignatureRequest,
)

# 손가락으로 그린 서명치고 지나치게 큰 데이터(악의적으로 큰 이미지를 밀어넣는 경우)를
# 막는다. 실제 서명 PNG는 보통 수십 KB대라 여유 있게 잡았다.
MAX_SIGNATURE_BYTES = 500_000

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str):
    job = JOBS.get(job_id)
    # 현장 작업 사진/블로그 글은 사후에 /api/quotes/{job_id}/photos, /blog 로만
    # 저장 파일에 추가되고 인메모리 JOBS에는 절대 반영되지 않는다 — job이 메모리에
    # 살아 있는 상태(같은 서버 세션에서 방금 완료된 견적)라도 여기서 항상 저장
    # 파일을 함께 읽어 덧붙여야, 사진을 올린 직후 새로고침 없이도 화면에 보인다.
    quote = load_quote(job_id)

    if job is not None:
        # job 딕셔너리는 regions_internal/current_image_path 같은 내부 전용 필드도
        # 함께 들고 있으므로, 응답 스키마에 정의된 필드만 명시적으로 골라 넣는다.
        return JobStatusResponse(
            job_id=job_id,
            status=job["status"],
            stage=job.get("stage"),
            rendered_image_url=job.get("rendered_image_url"),
            original_image_url=job.get("original_image_url"),
            mask_preview_url=job.get("mask_preview_url"),
            regions=job.get("regions", []),
            estimate=job.get("estimate"),
            error=job.get("error"),
            notices=job.get("notices", []),
            editing=job.get("editing", False),
            editing_region_id=job.get("editing_region_id"),
            edit_error=job.get("edit_error"),
            customer_name=job.get("customer_name", ""),
            created_at=job.get("created_at"),
            work_photos=(quote or {}).get("work_photos", []),
            blog_post=(quote or {}).get("blog_post"),
            signature=(quote or {}).get("signature"),
        )

    # 서버가 재시작돼 인메모리 JOBS에서 사라졌거나(브라우저를 오래 열어둔 경우 등)
    # 사용자가 "뒤로가기"/"불러오기"로 예전 완료된 견적서를 다시 찾는 경우,
    # 파일로 저장된 스냅샷에서 복원한다.
    if quote is not None:
        return JobStatusResponse(**quote)

    raise HTTPException(status_code=404, detail="Job not found")


def _get_or_restore_job(job_id: str) -> dict | None:
    """인메모리 JOBS에 없으면 저장된 견적서 스냅샷으로 되살린다.

    개발 중 --reload로 서버가 재시작되거나 사용자가 예전 견적서를 "불러오기"로
    연 직후 색상 스와치를 누르면, 예전에는 편집에 필요한 내부 상태(부위별 마스크
    경로, 현재 결과 이미지 경로)가 메모리에서 사라져 "Job not found"가 떴다."""
    job = JOBS.get(job_id)
    if job is not None:
        return job

    quote = load_quote(job_id)
    if quote is None or not quote.get("regions_internal") or not quote.get("current_image_path"):
        return None

    JOBS[job_id] = {
        "status": quote.get("status", "done"),
        "rendered_image_url": quote.get("rendered_image_url"),
        "original_image_url": quote.get("original_image_url"),
        "mask_preview_url": quote.get("mask_preview_url"),
        "regions": quote.get("regions", []),
        "estimate": quote.get("estimate"),
        "regions_internal": quote["regions_internal"],
        "current_image_path": quote["current_image_path"],
        "editing": False,
        "editing_region_id": None,
        "edit_error": None,
        "customer_name": quote.get("customer_name", ""),
        "created_at": quote.get("created_at"),
    }
    return JOBS[job_id]


@router.post("/{job_id}/inpaint", response_model=InpaintAcceptedResponse)
async def inpaint_job_region(job_id: str, request: InpaintRequest, background_tasks: BackgroundTasks):
    job = _get_or_restore_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="이 견적서의 부위 편집 정보를 찾을 수 없습니다. "
            "(서버 업데이트 이전에 만든 견적서는 사진을 다시 올려 시뮬레이션해주세요.)",
        )
    if job.get("status") != "done":
        raise HTTPException(status_code=409, detail="아직 AI 시뮬레이션이 완료되지 않았습니다.")
    if job.get("editing"):
        raise HTTPException(status_code=409, detail="다른 부위 편집이 진행 중입니다. 잠시 후 다시 시도해주세요.")

    region = job.get("regions_internal", {}).get(request.region_id)
    if region is None:
        raise HTTPException(status_code=404, detail="선택한 부위를 찾을 수 없습니다.")
    if request.pattern_id not in PATTERNS:
        raise HTTPException(status_code=422, detail="존재하지 않는 색상/패턴입니다.")

    job["editing"] = True
    job["editing_region_id"] = request.region_id
    job["edit_error"] = None
    background_tasks.add_task(
        run_inpaint_edit, job_id, request.region_id, request.pattern_id, request.grain_horizontal
    )
    return InpaintAcceptedResponse(accepted=True)


@router.post("/{job_id}/edited_image")
async def save_edited_image(job_id: str, image: UploadFile = File(...)):
    """사장님이 결과 사진 위에서 직접 구역을 나눠 편집한 결과를 시공 후 사진으로 확정한다.

    구역 나누기/크기 조절/색 입히기는 전부 브라우저 캔버스에서 즉시 처리되고(AI 호출
    없음), 확정한 순간에만 합성된 이미지를 여기로 올린다. 이후 견적서/블로그가 참조하는
    사진이 이 결과로 바뀌므로 current_image_path까지 함께 옮겨, 다음 AI 편집도 편집본
    위에서 이어지게 한다."""
    job = _get_or_restore_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")
    if job.get("editing"):
        raise HTTPException(status_code=409, detail="AI 편집이 진행 중입니다. 끝난 뒤 저장해주세요.")

    raw_bytes = await image.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="편집 결과 이미지가 비어 있습니다.")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            normalized = img.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="편집 결과 이미지를 읽을 수 없습니다.") from exc

    edited_path = f"storage/results/{job_id}_edited_{uuid.uuid4().hex[:8]}.png"
    normalized.save(edited_path, "PNG")

    job["current_image_path"] = edited_path
    job["rendered_image_url"] = _to_static_url(edited_path)
    job["edit_error"] = None
    save_quote(job_id, _quote_snapshot(job_id))
    return {"rendered_image_url": job["rendered_image_url"]}


@router.post("/{job_id}/illustration", response_model=InpaintAcceptedResponse)
async def add_illustration(
    job_id: str,
    request: IllustrationRequest,
    background_tasks: BackgroundTasks,
    x_admin_token: str | None = Header(default=None),
):
    """결과 사진에 고객이 원하는 문구/그림을 AI로 바로 그려 넣는다. 사장님 전용."""
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=403, detail="일러스트는 사장님 기기에서만 쓸 수 있어요.")
    job = _get_or_restore_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")
    if job.get("status") != "done":
        raise HTTPException(status_code=409, detail="아직 AI 시뮬레이션이 완료되지 않았습니다.")
    if job.get("editing"):
        raise HTTPException(status_code=409, detail="다른 편집이 진행 중입니다. 잠시 후 다시 시도해주세요.")
    if not request.text.strip() and not request.description.strip():
        raise HTTPException(status_code=422, detail="문구 또는 그림 설명 중 하나는 입력해주세요.")

    job["editing"] = True
    job["editing_region_id"] = None
    job["edit_error"] = None
    background_tasks.add_task(run_illustration_edit, job_id, request.text, request.description)
    return InpaintAcceptedResponse(accepted=True)


@router.post("/{job_id}/remask", response_model=InpaintAcceptedResponse)
async def remask(
    job_id: str,
    background_tasks: BackgroundTasks,
    payload: str = Form(...),
    masks: list[UploadFile] = File(default=[]),
):
    """결과 사진 위에 다시 잡은 구역만 새로 렌더링한다(부분 재시뮬레이션).

    처음 견적을 낼 때와 같은 형식(도형에서 구운 하드 마스크 + 자재/추가요청)을 받되,
    바탕 이미지는 원본이 아니라 "지금 화면에 떠 있는 시공 후 사진"이다.
    고객 앞에서 한 곳씩 바꿔 보는 흐름이라, 앞서 정한 시공이 남아 있어야 한다."""
    job = _get_or_restore_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="견적서를 찾을 수 없습니다.")
    if job.get("editing"):
        raise HTTPException(status_code=409, detail="다른 편집이 진행 중입니다. 잠시 후 다시 시도해주세요.")

    try:
        regions_in = json.loads(payload).get("regions", [])
    except (json.JSONDecodeError, AttributeError) as exc:
        raise HTTPException(status_code=422, detail="요청 형식이 올바르지 않습니다.") from exc
    if not regions_in:
        raise HTTPException(status_code=422, detail="다시 시공할 구역이 없습니다.")

    base_path = job.get("current_image_path")
    if not base_path or not os.path.exists(base_path):
        raise HTTPException(status_code=409, detail="다시 손볼 시공 후 사진이 없습니다.")
    with Image.open(base_path) as base:
        size = base.size

    mask_bytes = [await m.read() for m in masks]
    regions: list[dict] = []
    for index, region in enumerate(regions_in, start=1):
        mask_index = region.get("mask_index", index - 1)
        if not 0 <= mask_index < len(mask_bytes):
            raise HTTPException(
                status_code=422, detail=f"{index}번째 구역의 마스크 이미지가 함께 오지 않았습니다."
            )
        try:
            mask = _decode_mask(mask_bytes[mask_index], size)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"{index}번째 구역을 읽지 못했습니다: {exc}") from exc
        mask_path = f"storage/uploads/{job_id}_remask{uuid.uuid4().hex[:8]}.png"
        mask.save(mask_path)
        regions.append(
            {
                "mask_path": mask_path,
                "category": region.get("category", ""),
                "option": region.get("option", ""),
                "prompt": manual_base_prompt(
                    region.get("category", ""),
                    region.get("option", ""),
                    region.get("option_label", ""),
                ),
                "task_type": region.get("task_type", "surface_change"),
                "custom_design": region.get("custom_design", ""),
                "door_material": region.get("door_material", "wood"),
            }
        )

    job["editing"] = True
    job["editing_region_id"] = None
    job["edit_error"] = None
    background_tasks.add_task(run_remask, job_id, regions)
    return InpaintAcceptedResponse(accepted=True)


@router.post("/{job_id}/signature", response_model=JobStatusResponse)
async def sign_job(job_id: str, request: SignatureRequest):
    """현장에서 고객이 화면에 직접 그려 견적에 서명한다.

    다른 현장 기록(작업사진 등)과 같은 이유로 인증을 요구하지 않는다 — 추측 불가능한
    job_id를 아는 사람(사장님 기기로 보여주고 있는 바로 그 화면)만 서명할 수 있고,
    이 서명은 사장님이 그 자리에서 고객에게 폰을 건네 받는 것이지 로그인 계정이
    없는 고객이 따로 들어와서 하는 동작이 아니다."""
    quote = load_quote(job_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="이 견적서를 찾을 수 없습니다.")
    if quote.get("signature"):
        raise HTTPException(status_code=409, detail="이미 서명이 완료된 견적서입니다.")
    if not request.image.startswith("data:image/png;base64,"):
        raise HTTPException(status_code=422, detail="서명 이미지 형식이 올바르지 않습니다.")
    if len(request.image) > MAX_SIGNATURE_BYTES:
        raise HTTPException(status_code=413, detail="서명 이미지가 너무 큽니다.")

    signature = {
        "image": request.image,
        "signed_at": datetime.now(timezone.utc).isoformat(),
    }
    updated = set_signature(job_id, signature)
    if updated is None:
        # load_quote 이후 거의 동시에 다른 요청이 먼저 서명한 드문 경합.
        raise HTTPException(status_code=409, detail="이미 서명이 완료된 견적서입니다.")
    return JobStatusResponse(**updated)


@router.delete("/{job_id}/signature", response_model=JobStatusResponse)
async def reset_job_signature(job_id: str, x_admin_token: str | None = Header(default=None)):
    """서명을 다시 받아야 할 때(잘못 그렸거나 고객이 바뀐 경우) 지운다.
    서명은 "고객이 동의했다"는 기록이라 사장님만 지울 수 있다."""
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 지울 수 있어요.")
    updated = clear_signature(job_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="이 견적서를 찾을 수 없습니다.")
    return JobStatusResponse(**updated)


def _decode_mask(raw: bytes, size: tuple[int, int]) -> Image.Image:
    """업로드된 마스크 PNG를 사진과 같은 크기의 하드 엣지 흑백 이미지로 만든다.
    흰색(255)이 다시 시공할 자리다."""
    if not raw:
        raise ValueError("빈 파일입니다")
    try:
        with Image.open(io.BytesIO(raw)) as mask:
            gray = mask.convert("L")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("이미지를 열 수 없습니다") from exc
    if gray.size != size:
        gray = gray.resize(size, Image.NEAREST)
    return gray.point(lambda v: 255 if v > 96 else 0, mode="L")
