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


def _ensure_masks(session: dict) -> list[np.ndarray]:
    """세션의 SAM 후보 마스크를 돌려준다. 아직 안 구했으면(이 세션에서 처음 쓰는
    AI 호출이면) 이번에 딱 한 번 Replicate를 불러 채운다 — segment_point와
    snap_to_object이 같은 캐시를 공유해, 둘 중 어느 쪽을 먼저 써도 그 다음부터는
    비용이 들지 않는다."""
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

    return session["masks"]


@router.post("/session/{session_id}/point")
async def segment_point(session_id: str, body: PointRequest):
    session = _SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="마스킹 세션이 만료됐어요. 사진을 다시 불러와 주세요.")

    masks = _ensure_masks(session)
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


# [판정 기준 — "손그림을 그려도 AI가 자주 못 찾는다" 신고로 완화함 (2026-10-25)]
# 처음엔 "사용자가 물체 면적의 60% 이상을 직접 덮었을 때만"로 좁게 잡았는데,
# 이 기능의 목적 자체가 "대충·일부만 그려도 채워달라"이므로 실제로는 거의 늘
# 60%에 못 미쳐 대부분 실패했다. 이제 두 기준 중 하나만 넘으면 같은 물체로 본다.
#   coverage(= 겹친 면적 / 후보 면적)   — 후보를 얼마나 "많이" 덮었는지
#   containment(= 겹친 면적 / 사용자가 그린 면적) — 사용자가 그린 부분이 그
#                                                후보 "안에" 얼마나 깔끔히
#                                                들어가 있는지
# 작은 후보(문짝 한 짝 등)는 coverage 기준으로, 사용자가 큰 물체의 한쪽 구석만
# 대충 그린 경우는 containment 기준으로 잡힌다 — 그려진 부분이 거의 전부 그
# 물체 안에만 있으면(containment 높음) 다른 물건과는 안 겹친 깨끗한 신호이므로
# coverage는 아주 낮아도(그려진 양이 적어도) 인정한다.
SNAP_MIN_COVERAGE = 0.4
SNAP_MIN_CONTAINMENT = 0.7
SNAP_LENIENT_MIN_COVERAGE = 0.08
# 후보가 사진 전체의 이 비율보다 크면(벽 전체·방 전체급) 아무리 겹침 비율이 높아도
# 건너뛴다 — 작게 칠한 손그림이 우연히 배경급 후보와 많이 겹쳐도 방 전체가
# 끌려오는 사고를 막는다. 상/하부장을 가까이서 찍은 사진은 문짝 하나가 화면의
# 절반 가까이 차지할 수 있어 기존 0.5보다 조금 더 여유를 뒀다.
SNAP_MAX_CANDIDATE_AREA_RATIO = 0.65


@router.post("/session/{session_id}/snap")
async def snap_to_object(session_id: str, mask: UploadFile = File(...)):
    """손그림(올가미)으로 채운 영역을 SAM 후보 물체 전체 윤곽으로 넓혀 돌려준다.

    [왜 필요한가 — "사물에서 잘린 부분은 시공이 안 된다" 신고]
    손그림 도구는 손가락이 지나간 자리를 그대로 닫아 채우는 올가미라, 사진 테두리에
    걸려 물체 일부가 화면 밖으로 나가 있거나 다른 물건에 가려 손으로 테두리를 끝까지
    두르지 못하면 그 부분은 색이 입혀지지 않는다. 이 엔드포인트는 사용자가 이미 칠한
    영역과 SAM이 찾아둔 물체 후보들을 겹쳐 보고, 어느 후보가 "같은 물체"라고 볼 만큼
    (coverage 또는 containment 기준, 아래 상수 참고) 겹치면 그 물체의 SAM 윤곽
    전체(손이 못 닿은 부분까지)를 사용자가 칠한 영역과 합쳐 하나의 다각형으로
    돌려준다. 기준을 넘는 후보가 여럿이면 가장 작은(=가장 구체적인) 것을 쓴다 —
    상하부장 전체를 아우르는 큰 후보보다 문짝 한 짝짜리 후보가 있으면 그걸 우선한다.
    기준을 넘는 후보가 하나도 없으면 None을 돌려줘 호출부가 원래 손그림만 그대로
    쓰게 한다 — AI가 실패하거나 세션이 없어도 손그림 자체는 늘 그대로 쓸 수 있어야
    한다."""
    session = _SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="마스킹 세션이 만료됐어요. 사진을 다시 불러와 주세요.")

    raw = await mask.read()
    try:
        with Image.open(io.BytesIO(raw)) as img:
            # 프론트가 사진 원본 해상도(session width x height)로 구워 보낸다 —
            # segment_point의 SAM 격자 해상도와 달리 여기는 변환 없이 그대로 쓴다.
            user_mask = np.array(img.convert("L")) > 127
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="손그림 마스크를 읽을 수 없습니다.") from exc

    masks = _ensure_masks(session)
    if not masks:
        print("[manual_mask] snap: 이 세션에 SAM 후보가 하나도 없음")
        return {"points": None}

    uh, uw = user_mask.shape
    user_area = int(user_mask.sum())
    if user_area == 0:
        return {"points": None}

    best: np.ndarray | None = None
    best_area: int | None = None
    best_score = (0.0, 0.0)  # 로그용 — 기준을 못 넘었을 때 "얼마나 모자랐는지" 보려고
    for arr in masks:
        h, w = arr.shape
        candidate_area = int(arr.sum())
        if candidate_area == 0 or candidate_area / (h * w) > SNAP_MAX_CANDIDATE_AREA_RATIO:
            continue
        resized_user = cv2.resize(user_mask.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
        inter = int((resized_user & arr).sum())
        if inter == 0:
            continue
        coverage = inter / candidate_area
        containment = inter / (user_area * (w * h) / (uw * uh))  # 사용자 면적도 후보 해상도 기준으로 환산
        passes = coverage >= SNAP_MIN_COVERAGE or (
            containment >= SNAP_MIN_CONTAINMENT and coverage >= SNAP_LENIENT_MIN_COVERAGE
        )
        if coverage > best_score[0]:
            best_score = (coverage, containment)
        if not passes:
            continue
        # 기준을 넘는 후보가 여럿이면 가장 작은(가장 구체적인) 것을 쓴다.
        if best_area is None or candidate_area < best_area:
            best, best_area = arr, candidate_area

    if best is None:
        print(f"[manual_mask] snap: 기준 미달 — 최선 coverage={best_score[0]:.2f}, containment={best_score[1]:.2f}")
        return {"points": None}

    h, w = best.shape
    resized_candidate = cv2.resize(best.astype(np.uint8), (uw, uh), interpolation=cv2.INTER_NEAREST) > 0
    combined = user_mask | resized_candidate

    polygon = _mask_to_polygon(combined.astype(np.uint8))
    if polygon is None:
        return {"points": None}
    # user_mask와 같은 해상도(session 원본 사진 크기)에서 뽑았으므로 추가 변환이 없다.
    return {"points": [{"x": x, "y": y} for x, y in polygon]}


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
