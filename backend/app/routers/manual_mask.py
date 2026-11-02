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
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

from app.config import get_settings
from app.services.segmentation import _fetch_mask_array, _generate_masks, segment_with_prompt

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

    # [먼저 "이 점의 물체"를 직접 묻는다 — 연습21 책장 사고]
    # 아래 자동 후보 방식은 흰 책장·문짝처럼 크고 밋밋한 물체를 후보로 아예 못 뽑는
    # 경우가 많아, 그런 물체를 눌러도 "못 찾음"이 됐다. 점 프롬프트 SAM은 누른 자리의
    # 물체 하나를 바로 돌려준다. 실패하거나 배경급(방 전체)이면 예전 방식으로 넘어간다.
    settings = get_settings()
    if settings.replicate_api_token:
        try:
            hit = await run_in_threadpool(
                segment_with_prompt,
                session["image_path"],
                settings.replicate_api_token,
                None,
                (int(round(body.x)), int(round(body.y))),
            )
        except Exception as exc:  # noqa: BLE001 - 실패하면 예전 자동 후보 방식으로
            print(f"[manual_mask] point: 점 프롬프트 SAM 실패 -> 자동 후보로 대체: {exc}")
            hit = None
        if hit is not None and hit.mean() <= SNAP_MAX_CANDIDATE_AREA_RATIO:
            polygons = _mask_to_polygons(hit)
            if polygons:
                h, w = hit.shape
                sx, sy = session["width"] / w, session["height"] / h
                scaled = [[{"x": x * sx, "y": y * sy} for x, y in poly] for poly in polygons]
                return {"points": scaled[0], "polygons": scaled}

    masks = await run_in_threadpool(_ensure_masks, session)
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


# 찾은 물체가 사진 전체의 이 비율보다 크면(벽 전체·방 전체급) 버린다 — 꾹 누르기가
# 방 전체를 끌어오는 사고를 막는다. 가까이서 찍은 사진은 가구 하나가 화면 절반
# 넘게 차지할 수 있어 0.5보다 여유를 뒀다.
SNAP_MAX_CANDIDATE_AREA_RATIO = 0.65


@router.post("/session/{session_id}/snap")
async def snap_to_object(
    session_id: str,
    mask: UploadFile = File(...),
    x: float | None = Form(None),
    y: float | None = Form(None),
):
    """손그림(올가미)으로 대충 칠한 영역을 "실제 물체 테두리"로 다듬어 돌려준다.

    [2026-11-02 재설계 — 연습21 책장: "꾹 눌러도 AI 영역이 안 잡힌다"]
    예전 방식은 사진 전체를 자동으로 훑은 SAM 후보 중 손그림과 겹치는 것을 골라
    손그림에 "더하기"만 했다. 실측해 보니 문제가 셋이었다.
      1. 자동 후보에 흰 책장 프레임·문짝 자체가 아예 없었다(책·장난감·바닥만 있음).
      2. 판정이 "후보가 손그림 안에 얼마나 들어가 있나"라서, 손그림 안의 책 한 권
         같은 작은 물건이 100%로 통과해 그게 "찾은 물체"로 뽑혔다(=아무 변화 없음).
      3. 더하기만 하니 손그림이 벽·옆 책장으로 번진 부분은 절대 안 지워졌다.
    지금은 손그림의 박스를 SAM에 직접 "이 안의 물체"로 지정해(segment_with_prompt)
    테두리를 받아오고, 결과로 손그림을 **교체**한다 — 번진 부분은 빠지고, 유리 너머
    책처럼 물체가 아닌 부분도 테두리 기준으로 정리된다. 손그림이 물체 두 개(예: 열린
    선반장 + 유리문장)에 걸쳐 있으면 남은 부분으로 한 번 더 묻는다. AI가 확인 못 한
    큰 덩어리는 손그림 그대로 남겨, 사장님이 칠한 영역이 통째로 사라지는 일은 없다.

    x, y(꾹 누른 자리)는 박스로 못 찾았을 때 점 프롬프트로 한 번 더 묻는 데 쓴다.
    결과가 없으면 {"points": None} — 호출부는 원래 손그림을 그대로 쓴다."""
    session = _SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="마스킹 세션이 만료됐어요. 사진을 다시 불러와 주세요.")

    raw = await mask.read()
    try:
        with Image.open(io.BytesIO(raw)) as img:
            # 프론트가 사진 원본 해상도(session width x height)로 구워 보낸다.
            user_mask = np.array(img.convert("L")) > 127
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="손그림 마스크를 읽을 수 없습니다.") from exc
    if not user_mask.any():
        return {"points": None}

    press = (x, y) if x is not None and y is not None else None
    result = await run_in_threadpool(_refine_user_mask, session, user_mask, press)
    if result is None:
        return {"points": None}
    polygons = _mask_to_polygons(result)
    if not polygons:
        return {"points": None}
    scaled = [[{"x": px, "y": py} for px, py in poly] for poly in polygons]
    return {"points": scaled[0], "polygons": scaled, "replace": True}


# 손그림 다듬기 판정 기준 (비율은 모두 면적 기준)
REFINE_MIN_COMPONENT = 0.05  # 손그림 덩어리 중 전체의 5% 미만(잔획)은 따로 묻지 않는다
REFINE_INSIDE_MIN = 0.6  # SAM 결과의 60% 이상이 손그림(+여유 폭) 안에 있어야 "같은 물체"
REFINE_MIN_SIZE = 0.15  # SAM 결과가 그 손그림 덩어리의 15%도 안 되면(책 한 권 등) 버린다
REFINE_RESIDUAL_ASK = 0.2  # 확인 안 된 손그림이 20% 이상 남으면 그 부분으로 한 번 더 묻는다
REFINE_RESIDUAL_KEEP = 0.12  # 끝까지 확인 안 된 덩어리도 이만큼 크면 손그림 그대로 남긴다
REFINE_MAX_CALLS = 3


def _kernel(radius: int) -> np.ndarray:
    radius = max(1, radius)
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))


def _components(mask: np.ndarray, min_area: int) -> list[np.ndarray]:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    comps = [(stats[i, cv2.CC_STAT_AREA], labels == i) for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] >= min_area]
    comps.sort(key=lambda c: -c[0])
    return [c[1] for c in comps]


def _bbox(mask: np.ndarray, pad_ratio: float = 0.03) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    h, w = mask.shape
    pad = int(max(xs.max() - xs.min(), ys.max() - ys.min()) * pad_ratio)
    return (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(w - 1, int(xs.max()) + pad),
        min(h - 1, int(ys.max()) + pad),
    )


def _refine_user_mask(session: dict, user_mask: np.ndarray, press: tuple[float, float] | None) -> np.ndarray | None:
    settings = get_settings()
    if not settings.replicate_api_token:
        raise HTTPException(status_code=503, detail="AI 객체 인식 기능이 이 서버에 설정되어 있지 않습니다.")

    h, w = user_mask.shape
    user_area = int(user_mask.sum())
    margin = _kernel(int(np.hypot(w, h) * 0.03))  # 손그림이 물체 가장자리에 못 미친 정도의 여유
    calls = 0

    def ask(region: np.ndarray, *, box: bool = True, point: tuple[int, int] | None = None) -> np.ndarray | None:
        nonlocal calls
        if calls >= REFINE_MAX_CALLS:
            return None
        calls += 1
        try:
            found = segment_with_prompt(
                session["image_path"],
                settings.replicate_api_token,
                box=_bbox(region) if box else None,
                point=point,
            )
        except Exception as exc:  # noqa: BLE001 - AI 실패는 "못 찾음"으로 처리
            print(f"[manual_mask] snap: SAM 프롬프트 호출 실패: {exc}")
            return None
        if found is None:
            return None
        if found.shape != (h, w):
            found = cv2.resize(found.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
        found_area = int(found.sum())
        if found_area == 0 or found_area / (h * w) > SNAP_MAX_CANDIDATE_AREA_RATIO:
            return None
        near_region = cv2.dilate(region.astype(np.uint8), margin) > 0
        inside = (found & near_region).sum() / found_area
        if inside < REFINE_INSIDE_MIN or found_area < REFINE_MIN_SIZE * region.sum():
            print(f"[manual_mask] snap: SAM 결과 기각 — inside={inside:.2f}, size={found_area / region.sum():.2f}")
            return None
        # 여유 폭 바깥으로 튀어나간 부분(옆 가구 등)은 잘라낸다.
        return found & near_region

    accepted = np.zeros_like(user_mask)
    for comp in _components(user_mask, int(user_area * REFINE_MIN_COMPONENT))[:2]:
        found = ask(comp)
        if found is not None:
            accepted |= found

    # 손그림이 물체 밖으로 번진 "얇은 띠"는 남기지도, 다시 묻지도 않는다 — 두께가
    # 이 정도도 안 되는 잔여는 번짐으로 본다. (연습22 시험: 물체를 감싼 U자 띠가 통째로
    # "확인 안 된 덩어리"로 남아 벽·옆 선반에 줄무늬로 칠해졌다.)
    thin = _kernel(int(np.hypot(w, h) * 0.025))

    def unexplained() -> list[np.ndarray]:
        covered = cv2.dilate(accepted.astype(np.uint8), margin) > 0
        rest = cv2.morphologyEx((user_mask & ~covered).astype(np.uint8), cv2.MORPH_OPEN, thin) > 0
        return _components(rest & user_mask, int(user_area * REFINE_RESIDUAL_KEEP))

    # 손그림이 물체 두 개에 걸쳐 있으면(열린 선반장 + 유리문장 등) 남은 쪽으로 한 번 더.
    for rest in unexplained():
        if rest.sum() < user_area * REFINE_RESIDUAL_ASK:
            break
        found = ask(rest)
        if found is not None:
            accepted |= found

    # 박스로 하나도 못 찾았으면 꾹 누른 점으로 마지막으로 묻는다.
    if not accepted.any() and press is not None:
        px, py = int(round(press[0])), int(round(press[1]))
        if 0 <= px < w and 0 <= py < h:
            found = ask(user_mask, box=False, point=(px, py))
            if found is not None:
                accepted |= found

    if not accepted.any():
        print(f"[manual_mask] snap: AI가 손그림 영역의 물체를 확인하지 못함 (호출 {calls}회)")
        return None

    result = accepted.copy()
    for rest in unexplained():
        result |= rest  # AI가 확인 못 한 큰 덩어리는 사장님이 칠한 그대로 둔다
    # 잔구멍·톱니 정리
    result = cv2.morphologyEx(result.astype(np.uint8), cv2.MORPH_CLOSE, _kernel(int(np.hypot(w, h) * 0.004))) > 0
    return result


def _simplify_contour(contour: np.ndarray, max_points: int) -> list[tuple[float, float]] | None:
    """외곽선을 max_points 이하로 단순화한다. 예전엔 점을 건너뛰며 솎아냈는데
    (points[int(i*step)]), 그러면 모서리 점이 빠져 테두리가 톱니처럼 튀었다 —
    지금은 허용 오차(epsilon)를 키워 가며 모양을 유지한 채 점 수를 줄인다."""
    perimeter = cv2.arcLength(contour, True)
    epsilon = max(1.0, perimeter * 0.002)
    approx = cv2.approxPolyDP(contour, epsilon, True)
    while len(approx) > max_points:
        epsilon *= 1.4
        approx = cv2.approxPolyDP(contour, epsilon, True)
    points = [(float(p[0][0]), float(p[0][1])) for p in approx]
    return points if len(points) >= 3 else None


def _mask_to_polygons(mask: np.ndarray, max_points: int = 160, min_area_ratio: float = 0.002) -> list[list[tuple[float, float]]]:
    """이진 마스크의 바깥 윤곽선들을 큰 것부터 다각형 목록으로 돌려준다(아주 작은
    조각은 버린다). 손그림 획 하나 = 다각형 하나로 프론트에 그대로 들어간다."""
    mask_u8 = mask.astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    min_area = max(16.0, mask.shape[0] * mask.shape[1] * min_area_ratio)
    polygons = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(contour) < min_area:
            break
        poly = _simplify_contour(contour, max_points)
        if poly:
            polygons.append(poly)
    return polygons


def _mask_to_polygon(mask: np.ndarray, max_points: int = 160) -> list[tuple[float, float]] | None:
    """가장 큰 윤곽선 하나만(자동 후보로 점 하나를 찾았을 때 쓰는 예전 경로)."""
    polygons = _mask_to_polygons(mask, max_points)
    return polygons[0] if polygons else None
