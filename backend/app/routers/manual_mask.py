"""수동 마스킹 화면에서 "꾹 눌러 AI가 물체를 찾아준다"를 지원하는 엔드포인트.

[왜 job 생성과 별개의 가벼운 세션인가]
이 요청은 사장님이 아직 견적 항목도 다 안 고른, 사진 위에 도형을 그리는 중에
온다 — 정식 작업(JOBS)으로 만들기엔 너무 이르다. 그래서 사진 하나만 올려
"마스킹 세션"을 열고, 그 세션 안에서 여러 번 점을 찍어 물체 윤곽을 받아본다.

[왜 점마다 SAM을 다시 안 부르는가]
이 백엔드가 쓰는 Replicate의 meta/sam-2는 "이 좌표의 물체만" 찾아주는
점 프롬프트를 지원하지 않는다 — 사진 전체를 격자로 훑어 후보 마스크를 왕창
뽑아주는 자동 모드만 있다. 그래서 세션의 첫 점 요청에서 딱 한 번 그 전체
후보를 구해 메모리에 쌓아 두고, 이후 같은 세션의 점 요청은 "그 후보들 중
이 좌표를 포함하는 것"을 즉시 찾아 돌려준다 — 두 번째 탭부터는 AI를 다시
부르지 않아 비용도 안 들고 즉시 응답한다."""

import io
import time
import uuid

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

from app.config import get_settings
from app.services.segmentation import _fetch_mask_array, _generate_masks

router = APIRouter(prefix="/api/manual-mask", tags=["manual-mask"])

# session_id -> {image_path, width, height, masks(None이면 아직 AI를 안 부름), created_at}
_SESSIONS: dict[str, dict] = {}
# 현장 방문 한 번(사진 한 장 작업)에 넉넉한 길이 — 그보다 오래된 세션은 다음
# 요청이 올 때 조용히 정리한다(이 앱 규모에서는 별도 백그라운드 청소가 과하다).
_SESSION_TTL_S = 30 * 60


def _cleanup_expired_sessions() -> None:
    now = time.time()
    expired = [sid for sid, s in _SESSIONS.items() if now - s["created_at"] > _SESSION_TTL_S]
    for sid in expired:
        _SESSIONS.pop(sid, None)


@router.post("/session")
async def create_mask_session(photo: UploadFile = File(...)):
    """손그림 화면에 올라온 사진으로 세션을 연다. 이 호출 자체는 AI를 부르지
    않는다 — 실제로 '꾹 누르기'를 한 번이라도 써야만 SAM이 돈다(안 쓰면
    비용이 전혀 안 든다)."""
    raw = await photo.read()
    if not raw:
        raise HTTPException(status_code=422, detail="사진 파일이 비어 있습니다.")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            normalized = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="사진 파일을 읽을 수 없습니다.") from exc

    _cleanup_expired_sessions()
    session_id = str(uuid.uuid4())
    image_path = f"storage/uploads/mask_session_{session_id}.jpg"
    normalized.save(image_path, "JPEG", quality=90)
    _SESSIONS[session_id] = {
        "image_path": image_path,
        "width": normalized.width,
        "height": normalized.height,
        "masks": None,
        "created_at": time.time(),
    }
    return {"session_id": session_id}


class PointRequest(BaseModel):
    # 사진 원본 픽셀 좌표 (프론트 전체가 이 기준을 쓴다 — lib/maskShapes.ts 참고)
    x: float
    y: float


@router.post("/session/{session_id}/point")
async def segment_point(session_id: str, body: PointRequest):
    session = _SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="마스킹 세션이 만료됐어요. 사진을 다시 불러와 주세요.")

    settings = get_settings()
    if not settings.replicate_api_token:
        raise HTTPException(status_code=503, detail="AI 객체 인식 기능이 이 서버에 설정되어 있지 않습니다.")

    if session["masks"] is None:
        try:
            raw_masks = _generate_masks(session["image_path"], settings.replicate_api_token)
        except Exception as exc:  # noqa: BLE001 - 외부 AI 실패를 사용자가 읽을 메시지로 바꾼다
            raise HTTPException(status_code=502, detail=f"AI 물체 인식에 실패했습니다: {exc}") from exc
        arrays: list[np.ndarray] = []
        for item in raw_masks:
            arr = _fetch_mask_array(item["mask_url"])
            if arr is not None:
                arrays.append(arr)
        session["masks"] = arrays

    masks = session["masks"]
    if not masks:
        raise HTTPException(status_code=404, detail="이 사진에서는 물체를 찾지 못했어요.")

    # [가장 작은 것을 고른다]
    # 이 좌표를 포함하는 후보가 여러 개일 수 있다(문짝 하나짜리 작은 마스크부터
    # 상하부장 전체를 아우르는 큰 마스크까지). 손가락으로 꾹 누른 그 물체 하나만
    # 원하는 것이므로, 포함하는 후보 중 면적이 가장 작은 것을 고른다.
    best: np.ndarray | None = None
    best_area: int | None = None
    for arr in masks:
        h, w = arr.shape
        mx = int(round(body.x * w / session["width"]))
        my = int(round(body.y * h / session["height"]))
        if mx < 0 or mx >= w or my < 0 or my >= h or not arr[my, mx]:
            continue
        area = int(arr.sum())
        if best_area is None or area < best_area:
            best, best_area = arr, area

    if best is None:
        raise HTTPException(status_code=404, detail="이 자리에서 물체를 찾지 못했어요. 조금 더 안쪽을 눌러보세요.")

    polygon = _mask_to_polygon(best)
    if polygon is None:
        raise HTTPException(status_code=404, detail="물체 테두리를 만들지 못했어요.")

    h, w = best.shape
    scale_x = session["width"] / w
    scale_y = session["height"] / h
    return {"points": [{"x": x * scale_x, "y": y * scale_y} for x, y in polygon]}


def _mask_to_polygon(mask: np.ndarray, max_points: int = 60) -> list[tuple[float, float]] | None:
    """이진 마스크의 가장 큰 외곽선을 뽑아 다각형 점 목록으로 단순화한다.
    점이 너무 많으면(수백 개) 프론트에서 그리기·전송이 무거워지므로
    max_points로 추려낸다."""
    mask_u8 = mask.astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < 16:
        return None
    perimeter = cv2.arcLength(largest, True)
    epsilon = max(1.0, perimeter * 0.004)
    approx = cv2.approxPolyDP(largest, epsilon, True)
    points = [(float(p[0][0]), float(p[0][1])) for p in approx]
    if len(points) < 3:
        return None
    if len(points) > max_points:
        step = len(points) / max_points
        points = [points[int(i * step)] for i in range(max_points)]
    return points
