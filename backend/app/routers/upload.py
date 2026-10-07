import io
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, Header, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError

from app.catalog import manual_base_prompt
from app.jobs_store import JOBS
from app.owner_auth import is_owner
from app.pipeline import run_pipeline
from app.schemas import CreateJobRequest, JobCreateResponse

try:
    import pillow_heif

    pillow_heif.register_heif_opener()  # 아이폰 카메라의 HEIC/HEIF 사진도 열 수 있게 등록
except ImportError:
    pass

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("", response_model=JobCreateResponse)
async def create_job(
    background_tasks: BackgroundTasks,
    photo: UploadFile = File(...),
    payload: str = Form(...),
    # 수동 모드에서 칠한 영역 마스크들. 원본 사진과 같은 요청으로 함께 올라온다.
    masks: list[UploadFile] = File(default=[]),
    x_admin_token: str | None = Header(default=None),
):
    try:
        request = CreateJobRequest.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    # 일러스트는 사장님 전용 항목이다. 학생 기기가 항목·문구·그림을 보내면 거절한다.
    wants_illustration = "illustration" in request.selected_items or bool(
        request.illustration_text.strip() or request.illustration_description.strip()
    )
    if wants_illustration and not is_owner(x_admin_token):
        raise HTTPException(status_code=403, detail="일러스트는 사장님 기기에서만 쓸 수 있어요.")
    # 문구·그림 설명은 "일러스트" 항목을 고른 경우에만 사진에 반영한다.
    if "illustration" not in request.selected_items:
        request.illustration_text = ""
        request.illustration_description = ""

    if not request.selected_items:
        raise HTTPException(status_code=422, detail="선택된 시공 항목이 없습니다.")

    raw_bytes = await photo.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="업로드된 사진 파일이 비어 있습니다. 다시 촬영해주세요.")

    # 원본 포맷(HEIC 등)이 무엇이든 이후 파이프라인(OpenCV/PIL)이 항상 다룰 수 있는
    # JPEG로 여기서 한 번에 정규화한다. 여기서 걸러야 SAM/렌더링 단계에서
    # cv2.imread가 None을 반환해 뒤늦게 알 수 없는 오류로 터지는 것을 막을 수 있다.
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            # 폰 카메라는 센서를 세로로 돌려 찍어도 픽셀은 가로로 저장하고 "회전해서
            # 보라"는 EXIF 방향값만 남긴다. PIL은 그 값을 무시하므로, 그대로 두면
            # 눕혀진 사진이 파이프라인에 들어가 SAM/Gemini 인식률이 크게 떨어진다
            # (실제 업로드본 중 90도 누운 채로 저장된 건이 있었다).
            normalized = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=422,
            detail="사진 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다 "
            "(지원 형식: JPG, PNG, HEIC).",
        ) from exc

    job_id = str(uuid.uuid4())
    image_path = f"storage/uploads/{job_id}.jpg"
    normalized.save(image_path, "JPEG", quality=92)

    # 수동 모드로 보낸 영역들: 사진과 함께 한 번에 올라온 마스크(dataURL)를 파일로
    # 풀어 둔다. 사진 해상도에 맞춰 저장해야 나중에 그대로 겹쳐 쓸 수 있다.
    mask_bytes = [await m.read() for m in masks]
    manual_regions: list[dict] = []
    for index, region in enumerate(request.manual_regions, start=1):
        if not 0 <= region.mask_index < len(mask_bytes):
            raise HTTPException(
                status_code=422, detail=f"{index}번째 지정 영역의 마스크 이미지가 함께 오지 않았습니다."
            )
        try:
            mask = _decode_mask(mask_bytes[region.mask_index], normalized.size)
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail=f"{index}번째 지정 영역을 읽지 못했습니다: {exc}"
            ) from exc
        mask_path = f"storage/uploads/{job_id}_manual{index}_mask.png"
        mask.save(mask_path)
        manual_regions.append(
            {
                "mask_path": mask_path,
                "category": region.category,
                "option": region.option,
                "option_label": region.option_label or region.option,
                "task_type": region.task_type,
                # 프론트가 보내는 prompt는 사용자에게 보여준 한글 이름("실링팬 (블랙)")이다.
                # SDXL은 한글을 거의 못 알아들으므로 항목·옵션 id로 영문 명사구를 찾아
                # 쓰고, 모르는 조합일 때만 한글을 그대로 넘긴다.
                "prompt": manual_base_prompt(
                    region.category,
                    region.option,
                    region.prompt or region.option_label or region.option,
                ),
                "custom_design": region.custom_design,
                "door_material": region.door_material,
            }
        )

    JOBS[job_id] = {"status": "queued", "customer_name": request.customer_name}
    background_tasks.add_task(
        run_pipeline,
        job_id,
        image_path,
        request.selected_items,
        request.options,
        request.customer_name,
        request.illustration_text,
        request.illustration_description,
        request.render_mode,
        request.auto_description,
        manual_regions,
    )
    return JobCreateResponse(job_id=job_id, status="queued")


def _decode_mask(raw: bytes, size: tuple[int, int]) -> Image.Image:
    """업로드된 마스크 PNG를 사진과 같은 크기의 하드 엣지 흑백 이미지로 만든다.
    흰색(255)이 시공할 자리다."""
    if not raw:
        raise ValueError("빈 파일입니다")
    try:
        with Image.open(io.BytesIO(raw)) as mask:
            gray = mask.convert("L")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("이미지를 열 수 없습니다") from exc

    if gray.size != size:
        gray = gray.resize(size, Image.NEAREST)
    # 반투명 붓 자국이 섞여 들어와도 시공/비시공이 분명해지도록 이진화한다.
    return gray.point(lambda v: 255 if v > 96 else 0, mode="L")
