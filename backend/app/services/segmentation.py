"""천장/벽면 영역 분리 + 시공 항목별 개별 객체(상부장 문짝, 방문 등) 인식.

Replicate의 meta/sam-2는 "박스/포인트를 찍어서 지정한 객체만 분할"하는 프롬프트형
모델이 아니라 사진 전체를 무작위로 훑어 가능한 모든 후보 마스크를 뽑아내는
Automatic Mask Generator다 (모델 스펙을 실제로 조회해 확인함: image 외에는
points_per_side 등 샘플링 파라미터만 받고 box/point 입력은 아예 없음). 즉 "상부장
문짝만 짚어서 분할해줘" 같은 요청은 SAM 쪽에 보낼 수 없다.

그래서 이 모듈은 2단계로 동작한다.
1) SAM Automatic Mask Generator로 사진 안의 모든 물체/영역 후보를 촘촘하게 추출
   (points_per_side를 높여 상/하부장 문짝 한 짝 단위까지 잡히도록 함).
2) Set-of-Mark 프롬프팅(후보마다 번호를 매긴 사각형을 그려 넣고 한 번의 Gemini
   Vision 호출로) 각 후보가 이번 견적에서 의미 있는 대상 중 무엇인지 분류한다.
   대상 카테고리는 사용자가 선택한 시공 항목에 따라 동적으로 구성한다
   (예: 필름+싱크볼이면 상부장/하부장 문짝·아일랜드 식탁·방문·문틀, 조명/실링팬이면
   천장·기존 조명 위치). 여러 개가 같은 카테고리로 분류되면 "상부장 문짝 1",
   "상부장 문짝 2"처럼 각각 독립된 마스크로 번호를 붙여 그대로 유지한다 —
   문짝 하나하나를 따로 클릭해 색을 바꿀 수 있어야 하기 때문이다.
   비전 API가 실패하거나 카테고리를 확정 못하면 기하학적 휴리스틱(천장/벽)이나
   화면상 세로 위치 기반 라벨("상부장 추정 2" 등)로 폴백해 인터랙션 자체는
   항상 가능하게 유지한다. Gemini 크레딧이 소진되면(429 RESOURCE_EXHAUSTED)
   전부 이 폴백 라벨로 나오므로, 라벨이 전부 "~추정"이면 키/크레딧을 먼저 확인할 것.
"""
import json
from io import BytesIO

import httpx
import numpy as np
import replicate
from google import genai
from google.genai import types
from PIL import Image, ImageDraw

from app.config import get_settings
from app.services.rendering import combine_masks
from app.services.timeouts import run_gemini_with_retry, run_replicate_with_retry

SAM_TIMEOUT_S = 90
VISION_TIMEOUT_S = 30

MIN_MASK_AREA_RATIO = 0.002  # 걸레받이/문틀처럼 가늘고 작은 객체도 놓치지 않도록 낮게 잡음
MAX_REGION_AREA_RATIO = 0.6  # 이 비율보다 크면 "개별 객체"가 아니라 배경급 영역으로 간주해 제외
EDGE_TOLERANCE_RATIO = 0.02  # 경계에 "닿아 있다"고 판단할 여유 폭
MAX_CLICKABLE_REGIONS = 24  # 다운로드/렌더링 부담을 줄이기 위한 클릭 가능 부위 상한
# 벽/천장은 사진에서 넓은 면을 차지하는 대상이므로, 이 비율보다 작은 후보는
# 아무리 점수가 높아도 벽/천장으로 채택하지 않는다 (작은 조각을 벽으로 잘못
# 골라 인페인팅해도 화면상 변화가 없어 보이는 문제 방지).
MIN_SURFACE_AREA_RATIO = 0.08

# Replicate API로 직접 조회해 실존을 확인한 meta/sam-2의 버전 해시.
# 이 모델은 image 외에 points_per_side/pred_iou_thresh/stability_score_thresh만
# 받는 "전체 자동 분할" 모델이며 box/point 프롬프트 입력은 지원하지 않는다.
# 출력은 {"combined_mask": uri, "individual_masks": [uri, ...]} 형태로 bbox/라벨을
# 주지 않아, 각 마스크 이미지를 내려받아 bbox/면적을 직접 계산해야 한다.
SAM_MODEL = "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83"
# "-latest" 별칭을 사용해 구글이 특정 세대 모델을 폐기해도 코드 수정 없이
# 항상 현재 권장되는 플래시 모델을 계속 사용하도록 한다.
GEMINI_MODEL = "gemini-flash-latest"
POINTS_PER_SIDE = 32  # 문짝 단위까지 분리되도록 SAM 기본값 수준으로 촘촘하게 샘플링

# 카테고리 id -> 화면에 보여줄 한글 이름. id는 segmentation/pipeline/estimator가
# 공유하는 내부 키이므로 임의로 바꾸지 말 것. 필름 견적 폼(상부장/하부장/아일랜드
# 식탁/방문/문틀/걸레받이·몰딩/냉장고장/펜트리장/신발장)과 1:1로 맞춰 두면,
# 사용자가 입력한 부위를 사진에서 클릭으로 찾아 색을 바꾸는 흐름이 자연스럽다.
CATEGORY_NAMES = {
    "wall": "벽",
    "ceiling": "천장",
    "upper_cabinet_door": "상부장 문짝",
    "lower_cabinet_door": "하부장 문짝",
    "island_table": "아일랜드 식탁",
    "door": "방문",
    "doorframe": "문틀",
    "baseboard": "걸레받이/몰딩",
    "fridge_cabinet": "냉장고장",
    "pantry_cabinet": "펜트리장",
    "shoe_cabinet": "신발장",
    "light_fixture": "기존 조명 위치",
    "sink_bowl": "싱크볼",
    "ceiling_fan": "실링팬",
    "window_sash": "샷시(창틀)",
    "glass_panel": "유리문/유리창",
}

# 방화/현관문은 같은 "door" 카테고리로 두되(시공 흐름·파이프라인은 그대로 쓴다),
# 화면에 보이는 이름만 따로 붙여 일반 방문과 구별되게 한다.
FIRE_DOOR_LABEL = "방화문(현관문)"


def door_label(door_kind: str) -> str:
    """문 종류("fire"/"plain")에 맞는 화면 표시 이름."""
    return FIRE_DOOR_LABEL if door_kind == "fire" else CATEGORY_NAMES["door"]


# 개수가 적고 사용자가 "콕 집어 색을 바꾸고 싶어 하는" 부위들. 문짝은 수십 개가
# 잡히는 반면 실링팬/싱크볼은 보통 한두 개뿐이라, 클릭 가능 부위 상한
# (MAX_CLICKABLE_REGIONS)에 밀려 잘려나가지 않도록 목록 앞쪽에 배치한다.
PRIORITY_CATEGORIES = ("ceiling_fan", "sink_bowl", "light_fixture", "window_sash", "glass_panel")

# SAM 자동 분할이 구조적으로 못 잡는 대상 — Gemini에게 위치를 직접 물어서 보완한다.
#
# SAM은 "색/질감이 균일한 덩어리"를 찾는데, 유리문은 그런 덩어리가 아니다. 표면이
# 투명해서 뒤 풍경과 반사가 그대로 비치는 탓에, 후보가 유리면 한 장이 아니라 유리에
# 비친 조각들(계단·가로수·주차된 차·손잡이)로 잘게 쪼개진다. 실제 유리문 사진 2건의
# SAM 후보를 확인해보니 각각 19개/30개 후보 중 유리면 전체를 덮는 후보가 하나도
# 없었고, 그래서 Gemini 분류 단계에 "유리문"이라는 선택지를 줘도 고를 대상 자체가
# 없어 매번 "인식된 문 없음"으로 끝났다. 박스 검출은 이 단계를 통째로 건너뛴다.
VISION_BOX_CATEGORIES = ("glass_panel", "window_sash", "door")
BOX_DETECT_TIMEOUT_S = 30
MAX_BOX_REGIONS = 8
# 박스 검출 결과가 사진을 거의 다 덮으면(예: 유리 너머 배경까지 통째로 잡은 경우)
# 클릭해도 시공 대상이 아니라 화면 전체가 선택돼 쓸모가 없으므로 버린다.
MAX_BOX_AREA_RATIO = 0.95
MIN_BOX_SIDE_PX = 8
# 유리와 그 틀은 거의 같은 자리에 겹쳐 잡힌다(실측: 유리문 4짝 사진에서 유리 상자와
# 창틀 상자가 3~5px 차이로 8개 검출). 둘 다 남기면 같은 자리에 클릭 대상이 두 겹으로
# 쌓여 어느 쪽이 유리인지 헷갈리므로, 많이 겹치면 하나만 남긴다.
BOX_DEDUP_IOU = 0.8
# 겹칠 때 남길 우선순위 — 썬팅/일러스트의 실제 시공면은 유리다.
BOX_CATEGORY_PRIORITY = ("glass_panel", "door", "window_sash")

# 시공 항목별로 어떤 카테고리를 SAM 후보 중에서 적극적으로 찾아야 하는지 정의.
# wall/ceiling은 패턴 워핑·원근 보정에 필요할 때만(needs_wall/needs_ceiling) 추가된다.
ITEM_TARGET_CATEGORIES: dict[str, list[str]] = {
    "film": [
        "upper_cabinet_door",
        "lower_cabinet_door",
        "island_table",
        "door",
        "doorframe",
        "baseboard",
        "fridge_cabinet",
        "pantry_cabinet",
        "shoe_cabinet",
        "wall",
    ],
    "sash": ["window_sash"],
    "glass": ["glass_panel", "window_sash"],
    "sink": ["sink_bowl", "upper_cabinet_door", "lower_cabinet_door", "island_table"],
    "lighting": ["ceiling", "light_fixture"],
    # 완성된 실링팬을 클릭해 날개 색을 바꿀 수 있어야 하므로 ceiling_fan도 찾는다.
    "fan": ["ceiling", "ceiling_fan"],
}


def _target_categories(selected_items: list[str], needs_ceiling: bool, needs_wall: bool) -> dict[str, str]:
    # 천장/벽은 실제로 필요할 때만 후보 카테고리에 넣는다 — 예를 들어 [인테리어 필름]으로
    # 싱크대 문짝 사진을 올린 경우(벽 시공 미포함)에는 애초에 "벽"을 찾을 이유가 없고,
    # Gemini에게 "벽"이라는 선택지를 억지로 쥐어주면 엉뚱한 후보를 벽으로 오분류하기도 쉽다.
    ids: set[str] = set()
    for item in selected_items:
        ids.update(ITEM_TARGET_CATEGORIES.get(item, []))
    if not needs_ceiling:
        ids.discard("ceiling")
    if not needs_wall:
        ids.discard("wall")
    return {cid: CATEGORY_NAMES[cid] for cid in ids}


def segment_surfaces(
    image_path: str,
    job_id: str,
    selected_items: list[str],
    needs_ceiling: bool = False,
    needs_wall: bool = False,
) -> dict:
    settings = get_settings()
    category_map = _target_categories(selected_items, needs_ceiling, needs_wall)

    # Replicate 토큰이 없으면 SAM 호출 자체를 시도하지 않고 바로 폴백으로 진행한다
    # (개발 초기/데모 환경에서 키 없이도 전체 사이클이 끊기지 않도록 하기 위함).
    if not settings.replicate_api_token:
        result = _fallback_masks(image_path, job_id, needs_ceiling, needs_wall)
        return _supplement_with_box_regions(result, image_path, job_id, category_map, settings.gemini_api_key)

    try:
        with Image.open(image_path) as img:
            width, height = img.size

        raw_masks = _generate_masks(image_path, settings.replicate_api_token)
        candidates = _score_candidates(raw_masks, width, height, image_path)

        if not candidates:
            raise RuntimeError("사진에서 유효한 영역 후보를 찾지 못했습니다.")

        vision_labels, fire_door_ids = (
            _classify_objects_with_vision(image_path, candidates, settings.gemini_api_key, category_map)
            if settings.gemini_api_key and category_map
            else ({}, set())
        )

        # 필요한 것만 찾는다 — 조명/실링팬 없이 필름(캐비닛)만 선택했다면 천장은
        # 아예 찾지 않고, 벽 시공을 포함하지 않았다면 벽도 찾지 않는다.
        image_area = width * height
        ceiling = _pick(candidates, vision_labels, "ceiling", image_area) if needs_ceiling else None
        wall = _pick(candidates, vision_labels, "wall", image_area) if needs_wall else None

        # 실링팬은 Gemini 분류가 실패해도(크레딧/과부하) 반드시 클릭할 수 있어야 하므로
        # 기하학적 특징으로도 한 번 더 찾아본다.
        fan_candidate = (
            _pick_ceiling_fan(candidates, vision_labels, width, height)
            if "fan" in selected_items
            else None
        )

        object_regions = _build_object_regions(
            candidates,
            vision_labels,
            ceiling,
            wall,
            category_map,
            job_id,
            width,
            height,
            fan_candidate,
            fire_door_ids,
        )

        # 천장/벽처럼 넓은 면은 SAM이 통째로 잡아주지 못하는 사진이 흔하다.
        # 그렇다고 전체를 폴백시키면 어렵게 찾아낸 문짝 단위 객체들까지 같이
        # 버려지므로(클릭할 부위가 사라짐), 못 찾은 면만 기하학적 추정으로
        # 채우고 개별 객체 인식 결과는 그대로 살린다.
        result: dict = {
            "regions": object_regions,
            # 넓은 면을 SAM이 실제로 찾았는지, 기하학적 추정으로 채웠는지 알린다.
            "wall_is_estimated": needs_wall and wall is None,
            "ceiling_is_estimated": needs_ceiling and ceiling is None,
        }
        if needs_ceiling:
            result["ceiling_mask_path"] = (
                _download_mask(ceiling["mask_url"], job_id, "ceiling")
                if ceiling is not None
                else _save_rect_mask(width, height, 0, 0, width, int(height * 0.35), job_id, "ceiling")
            )
        if needs_wall:
            result["wall_mask_path"] = (
                _download_mask(wall["mask_url"], job_id, "wall")
                if wall is not None
                else _save_rect_mask(
                    width, height, 0, int(height * 0.35), width, height, job_id, "wall"
                )
            )
    except Exception as exc:
        # SAM 모델 slug가 아직 미확정이거나 API 오류가 나도 파이프라인이 끊기지 않게 폴백한다.
        print(f"[segmentation] SAM 파이프라인 실패, 휴리스틱 폴백 마스크 사용: {exc}")
        result = _fallback_masks(image_path, job_id, needs_ceiling, needs_wall)

    return _supplement_with_box_regions(result, image_path, job_id, category_map, settings.gemini_api_key)


def _supplement_with_box_regions(
    result: dict, image_path: str, job_id: str, category_map: dict[str, str], gemini_api_key: str
) -> dict:
    """SAM 후보에 아예 나타나지 않는 대상(유리문 등)을 Gemini 박스 검출로 채워 넣는다.

    SAM이 이미 찾아낸 카테고리는 픽셀 단위 마스크가 사각형보다 정확하므로 건드리지
    않고, "한 개도 못 찾은" 카테고리에 대해서만 호출한다. SAM 자체가 실패해(429
    쓰로틀링·토큰 없음) 폴백으로 빠진 경우에도 이 보완은 그대로 동작해야 하므로
    성공/실패 경로 양쪽 끝에서 공통으로 부른다."""
    regions = result.get("regions", [])
    missing = {
        cid: name
        for cid, name in category_map.items()
        if cid in VISION_BOX_CATEGORIES and not any(r["category"] == cid for r in regions)
    }
    if not missing or not gemini_api_key:
        return result

    with Image.open(image_path) as img:
        width, height = img.size

    box_regions = _detect_regions_with_boxes(
        image_path, gemini_api_key, missing, job_id, width, height, len(regions)
    )
    if box_regions:
        # 사용자가 시공하려는 바로 그 대상이므로 클릭 목록 맨 앞에 둔다.
        result["regions"] = (box_regions + regions)[:MAX_CLICKABLE_REGIONS]
    return result


def _fallback_masks(image_path: str, job_id: str, needs_ceiling: bool, needs_wall: bool) -> dict:
    """SAM/비전 API 없이도 파이프라인이 끝까지 돌아가도록 하는 개발용 폴백.
    화면 상단 35%를 천장, 나머지 하단을 벽으로 단순 분할한다 — 단, 실제로
    필요한 것만 만든다. 예를 들어 [인테리어 필름]으로 싱크대 문짝 사진을
    올렸을 때(천장/벽 모두 불필요)는 엉뚱한 천장/벽 마스크를 억지로 만들어
    클릭 대상으로 내놓지 않고 빈 결과를 반환한다.
    실제 서비스에서는 반드시 SAM 기반 결과로 대체해야 한다.
    """
    with Image.open(image_path) as img:
        width, height = img.size
    split_y = int(height * 0.35)

    result: dict = {"regions": [], "wall_is_estimated": True, "ceiling_is_estimated": True}

    if needs_ceiling:
        ceiling_mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(ceiling_mask).rectangle([0, 0, width, split_y], fill=255)
        ceiling_path = f"storage/uploads/{job_id}_ceiling_mask.png"
        ceiling_mask.save(ceiling_path)
        result["ceiling_mask_path"] = ceiling_path
        result["regions"].append(
            {"id": "ceiling", "label": "천장", "category": "ceiling", "bbox": [0, 0, width, split_y], "mask_path": ceiling_path}
        )

    if needs_wall:
        wall_mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(wall_mask).rectangle([0, split_y, width, height], fill=255)
        wall_path = f"storage/uploads/{job_id}_wall_mask.png"
        wall_mask.save(wall_path)
        result["wall_mask_path"] = wall_path
        result["regions"].append(
            {
                "id": "wall",
                "label": "벽",
                "category": "wall",
                "bbox": [0, split_y, width, height - split_y],
                "mask_path": wall_path,
            }
        )

    return result


def _generate_masks(image_path: str, api_token: str) -> list[dict]:
    client = replicate.Client(api_token=api_token)
    with open(image_path, "rb") as f:
        # SAM 콜드스타트/큐 지연으로 무한정 블로킹되어 잡이 "처리 중"에 영원히
        # 멈추는 것(무한 로딩)을 막기 위해 하드 타임아웃을 건다. 크레딧이 적어
        # 걸리는 429 쓰로틀링은 잠깐 기다렸다 재시도한다.
        output = run_replicate_with_retry(
            client.run, SAM_TIMEOUT_S, SAM_MODEL, input={"image": f, "points_per_side": POINTS_PER_SIDE}
        )

    # SAM-2가 마스크를 하나도 찾지 못하면 None이거나 빈 배열을 돌려줄 수 있다 —
    # 여기서 걸러야 이후 로직이 빈 배열/None에 .shape 등을 호출하다 죽지 않고
    # segment_surfaces()의 except 블록으로 넘어가 휴리스틱 폴백으로 진행된다.
    if not output or not output.get("individual_masks"):
        raise RuntimeError("SAM-2가 마스크를 반환하지 않았습니다 (빈 결과).")

    # replicate SDK 버전에 따라 개별 마스크가 URL 문자열이 아니라
    # replicate.helpers.FileOutput 객체로 올 수 있다 (.url 속성으로 실제 문자열
    # URL을 꺼내야 함) — 이걸 그대로 httpx.get()에 넘기면 TypeError가 나면서
    # 매번 조용히 폴백(휴리스틱 2분할/빈 결과)으로 떨어져, 실제로는 SAM이 정상
    # 동작 중인데도 "개별 객체를 하나도 못 찾음"으로 보이는 문제가 있었다.
    return [{"mask_url": _resolve_mask_url(item)} for item in output["individual_masks"]]


def _resolve_mask_url(item) -> str:
    return item.url if hasattr(item, "url") else str(item)


def _fetch_mask_array(mask_url: str) -> np.ndarray | None:
    """마스크 이미지를 내려받아 bool 배열로 돌려준다.
    meta/sam-2 API가 bbox/area 메타데이터를 주지 않기 때문에 필요한 보정 단계."""
    try:
        response = httpx.get(mask_url, timeout=30)
        response.raise_for_status()
        return np.array(Image.open(BytesIO(response.content)).convert("L")) > 127
    except Exception:
        return None


# --- "평평한 패널(문짝)다움" 판정 ---------------------------------------------
# Gemini 분류를 쓸 수 없을 때(키 미설정/크레딧 소진) SAM 후보를 전부 시공 대상으로
# 삼으면 타일 벽, 레인지후드, 밥솥 같은 것까지 같이 색이 바뀐다. 문짝은 (1) 마스크가
# bbox를 꽉 채우는 사각형이고 (2) 표면이 매끈해 밝기 변화(edge)가 적고 (3) 면 전체의
# 밝기 편차가 작다는 특징이 있어, 이 세 지표로 걸러낸다. 실제 주방 사진의 SAM 후보
# 24개로 캘리브레이션한 값이며, 문짝 15개는 모두 통과하고 타일 벽/후드/밥솥/천장등은
# 전부 걸러졌다.
PANEL_METRIC_WIDTH = 800  # 지표를 해상도와 무관하게 만들기 위한 기준 가로 픽셀
PANEL_MIN_FILL_RATIO = 0.55  # bbox 대비 마스크 채움 비율 (사각 패널이면 높다)
PANEL_MAX_EDGE_DENSITY = 12.0  # 면 안쪽 밝기 기울기 평균 (타일 줄눈이 있으면 커진다)
PANEL_MAX_LIGHTNESS_STD = 22.0  # 면 안쪽 밝기 표준편차 (후드/가전은 반사가 심해 커진다)


def _panel_metrics_context(image_path: str) -> dict:
    """패널 판정 지표를 계산할 기준 이미지(고정 가로폭으로 정규화)를 준비한다."""
    with Image.open(image_path) as img:
        rgb = img.convert("RGB")
        if rgb.width != PANEL_METRIC_WIDTH:
            ratio = PANEL_METRIC_WIDTH / rgb.width
            rgb = rgb.resize((PANEL_METRIC_WIDTH, max(1, round(rgb.height * ratio))), Image.BILINEAR)

    gray = np.asarray(rgb.convert("L"), dtype=np.float32)
    gx = np.abs(np.diff(gray, axis=1, prepend=gray[:, :1]))
    gy = np.abs(np.diff(gray, axis=0, prepend=gray[:1, :]))
    return {"size": rgb.size, "edges": gx + gy, "lightness": gray}


def _is_flat_panel(mask_arr: np.ndarray, ctx: dict) -> bool:
    target_w, target_h = ctx["size"]
    if mask_arr.shape != (target_h, target_w):
        resized = Image.fromarray(mask_arr.astype(np.uint8) * 255).resize(
            (target_w, target_h), Image.NEAREST
        )
        mask_arr = np.asarray(resized) > 127

    if mask_arr.sum() < 100:
        return False

    ys, xs = np.nonzero(mask_arr)
    bbox_area = (xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1)
    if mask_arr.sum() / bbox_area < PANEL_MIN_FILL_RATIO:
        return False
    if float(ctx["edges"][mask_arr].mean()) > PANEL_MAX_EDGE_DENSITY:
        return False
    return float(ctx["lightness"][mask_arr].std()) <= PANEL_MAX_LIGHTNESS_STD


def _score_candidates(masks: list[dict], width: int, height: int, image_path: str) -> list[dict]:
    image_area = width * height
    panel_ctx = _panel_metrics_context(image_path)
    edge_x = width * EDGE_TOLERANCE_RATIO
    edge_y = height * EDGE_TOLERANCE_RATIO

    scored = []
    for mask in masks:
        mask_arr = _fetch_mask_array(mask["mask_url"])
        if mask_arr is None or not mask_arr.any():
            continue
        ys, xs = np.nonzero(mask_arr)
        x, y = int(xs.min()), int(ys.min())
        w, h = int(xs.max()) - x, int(ys.max()) - y
        area = int(mask_arr.sum())
        if area / image_area < MIN_MASK_AREA_RATIO:
            continue

        touches_top = y <= edge_y
        touches_bottom = (y + h) >= height - edge_y
        touches_left = x <= edge_x
        touches_right = (x + w) >= width - edge_x
        aspect_ratio = w / max(h, 1)
        vertical_center_ratio = (y + h / 2) / height

        ceiling_score = 0.0
        if touches_top:
            ceiling_score += 2.0
        if aspect_ratio > 1.2:
            ceiling_score += 1.0
        ceiling_score += (1 - vertical_center_ratio)

        wall_score = 0.0
        if touches_left or touches_right:
            wall_score += 1.5
        if touches_bottom:
            wall_score += 0.5
        if not touches_top:
            wall_score += 1.0
        wall_score += vertical_center_ratio

        scored.append(
            {
                **mask,
                "bbox": (x, y, w, h),
                "ceiling_score": ceiling_score,
                "wall_score": wall_score,
                "is_panel": _is_flat_panel(mask_arr, panel_ctx),
            }
        )

    return scored


# --- Vision API 시스템 프롬프트 -----------------------------------------------
# 현장 테스트에서 일반 문짝·벽면·방화문(현관문)을 잘못 구분하는 비율이 높았다.
# 원인은 모델이 "문", "벽"이라는 단어만 보고 판단했기 때문이다. 그래서 각 부위를
# 눈으로 구별할 수 있는 구체적 부속품·경계선을 시스템 지시문에 명시하고, 사용자
# 요청(분류 호출·박스 검출 호출)이 모두 같은 기준을 쓰도록 한 곳에 모은다.
VISION_SYSTEM_INSTRUCTION = """\
너는 한국 아파트·주택 실내 사진에서 인테리어 필름 시공 부위를 찾는 전문가다.
잘못 분류하면 견적과 시공 결과가 틀어진다. 확신이 없으면 억지로 고르지 말고
"other"(또는 빈 배열)로 답하라.

[1. 방화문·현관문 판별 — 가장 먼저 확인]
방화문과 현관문은 일반 방문과 달리 아래 부속품이 있다. 문 한 짝마다 이 목록을
위에서부터 확인하고, 하나라도 뚜렷하면 방화문/현관문이다.
  (a) 상단 도어클로저: 문 위쪽 상단 프레임 가장자리에 붙은 얇은 직사각 금속 상자.
      상자에서 팔(암)이 뻗어 문틀 쪽으로 이어진다.
  (b) 디지털 도어락: 손잡이 옆이나 위에 있는 키패드 또는 액정 패널, 카드 리더.
  (c) 두꺼운 철제 문틀과 가스켓: 문과 문틀 사이에 검은 고무 패킹 띠가 보이거나,
      문틀 단면이 두꺼운 철판처럼 보인다.
  (d) 도어스토퍼(말굽): 바닥에 고정된 말굽 모양·원통형 스토퍼, 문 중앙의 외시경(작은 둥근 렌즈).
  (e) 방화 인증 표시 스티커, 문 하단의 철제 보강 판.
방화/현관문의 표면은 나무 결이 없는 페인트 칠한 금속 면이다.
위 부속품이 하나도 안 보이고 나무 결·나무 몰딩 패널·유리창이 있으면 일반 방문이다.
금속처럼 보여도 (a)~(e)가 없으면 일반 방문으로 판단하라.
  - 방화/현관문이면 door_kind = "fire", 일반 방문이면 "plain".

[2. 문짝 면적 기준 — 문짝 잎(판)만 잡는다]
- 문짝 잎의 경계는 다음 세 가지로 정한다.
  · 손잡이(도어캐치·레버·디지털 도어락 본체)의 위치 — 손잡이 쪽이 문짝의 한 가장자리다.
  · 경첩(힌지)이 달린 쪽 모서리 — 경첩 돌기나 경첩 자국이 보이는 쪽이 반대 가장자리다.
  · 문틀과의 단차 — 문짝 면과 문틀 면의 깊이 차이로 생기는 그림자 선이 문짝의 둘레선이다.
- 문짝 가로는 손잡이 쪽 가장자리에서 경첩 쪽 가장자리까지, 세로는 문지방(바닥)에서
  문틀 상단 단차선까지다.
- 두 짝 문이면 짝마다 따로 잡고, 두 짝이 맞닿는 세로 단차선으로 나눈다.
- 문틀(좁은 띠 몰딩), 도어클로저 상자, 문 위 상인방, 바닥 문지방은 문짝이 아니다.

[3. 벽면 기준 — 천장 몰딩과 걸레받이 사이의 넓은 평면]
- 벽면은 위쪽 경계가 천장 몰딩(천장과 벽이 만나는 띠)의 아랫선, 아래쪽 경계가
  걸레받이(바닥과 벽이 만나는 얇은 띠)의 윗선인 넓은 수직 평면이다.
- 좌우 경계는 모서리, 문틀, 창틀, 가구 측면이다.
- 벽면에서 제외할 것: 상부장·하부장 문짝, 문틀, 창문·샷시, 스위치·콘센트, 그림·액자.
- 타일 벽(줄눈이 격자로 반복)과 가구 뒷면은 벽면이 아니다. 타일이면 "other"다.
- 천장, 바닥, 가구 상판은 벽면이 아니다.

[4. 공통 규칙]
- 사진에 실제로 보이는 것만 분류한다. 없는 것을 만들어내지 않는다.
- 답은 지정된 JSON 형식으로만 한다. 설명 문장은 쓰지 않는다."""

# 카테고리별로 "이렇게 생긴 것"을 짧게 적어 분류 호출에 함께 준다. 카테고리 이름만으로는
# 문짝·문틀·벽·걸레받이를 가리기 어려웠다.
CATEGORY_VISUAL_HINTS = {
    "door": "문짝 한 짝 — 손잡이·경첩·문틀 단차가 있는 문 잎(방화/현관문 포함)",
    "doorframe": "문틀 — 문 둘레를 두르는 좁은 띠 몰딩(케이싱)",
    "wall": "벽면 — 천장 몰딩과 걸레받이 사이에 있는 넓은 수직 평면",
    "ceiling": "천장 — 방 위쪽 전체를 덮는 수평면",
    "baseboard": "걸레받이/몰딩 — 바닥과 벽이 만나는 얇은 가로 띠",
    "upper_cabinet_door": "상부장 문짝 — 주방 벽 위쪽 수납장의 문 한 짝",
    "lower_cabinet_door": "하부장 문짝 — 주방 바닥 쪽 수납장의 문 한 짝",
    "window_sash": "샷시(창틀) — 창문 프레임",
    "glass_panel": "유리문/유리창 — 유리 면 전체",
}


def _parse_fire_door_ids(parsed: dict) -> set[int]:
    """분류 응답의 fire_door_ids를 정수 집합으로 바꾼다. 잘못된 값은 무시한다."""
    fire_ids: set[int] = set()
    for raw in parsed.get("fire_door_ids", []) or []:
        try:
            fire_ids.add(int(raw))
        except (TypeError, ValueError):
            continue
    return fire_ids


def _classify_objects_with_vision(
    image_path: str, candidates: list[dict], api_key: str, category_map: dict[str, str]
) -> tuple[dict[int, str], set[int]]:
    """Set-of-Mark 프롬프팅으로 후보 마스크 각각을 category_map의 카테고리 id 중
    하나(또는 "other")로 분류한다. 한 번의 호출로 전체 후보를 동시에 처리한다.

    반환값: (번호 -> 카테고리 id, 방화/현관문으로 판별된 "door" 후보 번호 집합)."""
    try:
        marked_path = _draw_marks(image_path, candidates)

        client = genai.Client(api_key=api_key)
        marked_image = Image.open(marked_path)

        category_desc = "\n".join(
            f'- "{cid}" ({name}): {CATEGORY_VISUAL_HINTS.get(cid, name)}'
            for cid, name in category_map.items()
        )
        prompt = (
            "사진 위에 빨간 번호가 매겨진 사각 영역들이 있다. 각 번호가 가리키는 대상이 "
            "아래 카테고리 중 무엇인지 하나씩 판단하라. 각 카테고리의 설명을 기준으로 삼아라.\n"
            f"{category_desc}\n"
            '어디에도 명확히 해당하지 않으면 "other"로 답하라 (억지로 끼워맞추지 말 것). '
            '"door"로 답한 번호 중 시스템 지시의 방화/현관문 특징이 보이는 것은 '
            '"fire_door_ids"에 번호를 넣어라. '
            '다음 JSON 형식으로만 답하라: {"labels": {"1": "wall", "2": "upper_cabinet_door", "3": "door"}, '
            '"fire_door_ids": [3]}'
        )

        response = run_gemini_with_retry(
            client.models.generate_content,
            VISION_TIMEOUT_S,
            model=GEMINI_MODEL,
            contents=[prompt, marked_image],
            config=types.GenerateContentConfig(
                system_instruction=VISION_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
            ),
        )

        parsed = json.loads(response.text)
        labels = {int(k): v for k, v in parsed["labels"].items()}
        return labels, _parse_fire_door_ids(parsed)
    except Exception as exc:  # noqa: BLE001 - 분류 실패는 기하학적 휴리스틱으로 폴백
        print(f"[segmentation] 영역 분류(Gemini) 실패, 위치 기준 이름으로 대체: {exc}")
        return {}, set()


def _detect_regions_with_boxes(
    image_path: str,
    api_key: str,
    wanted: dict[str, str],
    job_id: str,
    width: int,
    height: int,
    start_index: int,
) -> list[dict]:
    """SAM 후보에 의존하지 않고 Gemini에게 대상의 위치 상자를 직접 물어 부위를 만든다.
    (왜 필요한지는 VISION_BOX_CATEGORIES 주석 참고.)

    마스크는 상자 모양 사각형이다. 유리문은 실제로 사각형인 데다, 반사가 심해 픽셀
    단위 경계를 신뢰할 수 없어서 사각형이 오히려 썬팅 면을 고르게 덮는다."""
    try:
        client = genai.Client(api_key=api_key)
        image = Image.open(image_path)
        category_desc = "\n".join(
            f'- "{cid}" ({name}): {CATEGORY_VISUAL_HINTS.get(cid, name)}' for cid, name in wanted.items()
        )
        prompt = (
            f"사진에서 다음 대상을 모두 찾아라:\n{category_desc}\n"
            "문짝은 손잡이·경첩·문틀 단차로 정해진 문 잎 한 짝만 상자로 잡아라 (문틀 띠 제외). "
            "문이 두 짝이면 짝마다 따로 잡아라. 방화/현관문이면 door_kind를 \"fire\", "
            "일반 방문이면 \"plain\"으로 표시하라. "
            "유리문/유리창은 유리에 비친 풍경(가로수·주차된 차·계단)이나 반사가 아니라 "
            "'유리면 한 장 전체'를 하나의 상자로 잡아라. "
            "해당하는 대상이 없으면 빈 배열로 답하라 (억지로 만들어내지 말 것). "
            '다음 JSON 형식으로만 답하라: {"objects": [{"label": "door", "door_kind": "plain", '
            '"box_2d": [ymin, xmin, ymax, xmax]}]} '
            "좌표는 이미지 기준 0~1000으로 정규화한 정수다."
        )
        response = run_gemini_with_retry(
            client.models.generate_content,
            BOX_DETECT_TIMEOUT_S,
            model=GEMINI_MODEL,
            contents=[prompt, image],
            config=types.GenerateContentConfig(
                system_instruction=VISION_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
            ),
        )
        parsed = json.loads(response.text)
        objects = parsed.get("objects", []) if isinstance(parsed, dict) else parsed
    except Exception as exc:  # noqa: BLE001 - 검출 실패는 기존 SAM 결과만으로 진행
        print(f"[segmentation] 박스 검출 실패, SAM 결과만 사용: {exc}")
        return []

    image_area = width * height
    # (카테고리 id, x0, y0, x1, y1, 문 종류) — 문 종류는 "door"에만 의미가 있고 그 밖은 "".
    boxes: list[tuple[str, int, int, int, int, str]] = []

    for obj in objects:
        if not isinstance(obj, dict):
            continue
        category_id = obj.get("label")
        box = obj.get("box_2d") or []
        if category_id not in wanted or len(box) != 4:
            continue
        try:
            ymin, xmin, ymax, xmax = (min(1000, max(0, int(v))) for v in box)
        except (TypeError, ValueError):
            continue

        x0, x1 = round(xmin / 1000 * width), round(xmax / 1000 * width)
        y0, y1 = round(ymin / 1000 * height), round(ymax / 1000 * height)
        w, h = x1 - x0, y1 - y0
        if w < MIN_BOX_SIDE_PX or h < MIN_BOX_SIDE_PX or (w * h) / image_area > MAX_BOX_AREA_RATIO:
            continue
        door_kind = ""
        if category_id == "door":
            door_kind = "fire" if str(obj.get("door_kind", "")).lower() == "fire" else "plain"
        boxes.append((category_id, x0, y0, x1, y1, door_kind))

    def priority(entry: tuple[str, int, int, int, int, str]) -> int:
        cid = entry[0]
        return BOX_CATEGORY_PRIORITY.index(cid) if cid in BOX_CATEGORY_PRIORITY else len(BOX_CATEGORY_PRIORITY)

    boxes.sort(key=priority)

    regions: list[dict] = []
    counters: dict[str, int] = {}
    kept: list[tuple[int, int, int, int]] = []

    for category_id, x0, y0, x1, y1, door_kind in boxes:
        if len(regions) >= MAX_BOX_REGIONS:
            break
        if any(_box_iou((x0, y0, x1, y1), other) >= BOX_DEDUP_IOU for other in kept):
            continue

        index = start_index + len(regions) + 1
        base_label = door_label(door_kind) if door_kind else wanted[category_id]
        counters[base_label] = counters.get(base_label, 0) + 1
        region = {
            "id": f"obj-{index}",
            "label": f"{base_label} {counters[base_label]}",
            "category": category_id,
            "bbox": [x0, y0, x1 - x0, y1 - y0],
            "mask_path": _save_rect_mask(width, height, x0, y0, x1, y1, job_id, f"obj{index}"),
            "is_panel": True,
        }
        if door_kind:
            region["door_kind"] = door_kind
        regions.append(region)
        kept.append((x0, y0, x1, y1))

    return regions


def _box_iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    if inter == 0:
        return 0.0
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0.0


def _draw_marks(image_path: str, candidates: list[dict]) -> str:
    image = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(image)

    for idx, c in enumerate(candidates, start=1):
        x, y, w, h = c["bbox"]
        draw.rectangle([x, y, x + w, y + h], outline=(255, 0, 0), width=3)
        draw.rectangle([x, y, x + 26, y + 20], fill=(255, 0, 0))
        draw.text((x + 5, y + 3), str(idx), fill=(255, 255, 255))

    marked_path = image_path.rsplit(".", 1)[0] + "_marked.jpg"
    image.save(marked_path, "JPEG")
    return marked_path


def _pick(
    candidates: list[dict],
    vision_labels: dict[int, str],
    target: str,
    image_area: int | None = None,
) -> dict | None:
    """천장/벽 후보를 고른다. 벽과 천장은 사진에서 넓은 면을 차지하는 대상이므로
    최소 면적 조건을 반드시 둔다 — 이게 없으면 SAM이 문짝 같은 작은 조각만
    내놓았을 때 바닥의 58×26px 종잇조각 같은 걸 "벽"으로 골라버려, 인페인팅은
    성공해도 화면에는 아무 변화가 없는 것처럼 보인다."""
    def big_enough(c: dict) -> bool:
        if image_area is None:
            return True
        x, y, w, h = c["bbox"]
        return (w * h) / image_area >= MIN_SURFACE_AREA_RATIO

    score_key = f"{target}_score"
    vision_matches = [
        c
        for idx, c in enumerate(candidates, start=1)
        if vision_labels.get(idx) == target and big_enough(c)
    ]
    if vision_matches:
        return max(vision_matches, key=lambda c: c[score_key])

    sizable = [c for c in candidates if big_enough(c)]
    if not sizable:
        return None
    return max(sizable, key=lambda c: c[score_key])


# 실링팬을 기하학적으로 추정할 때 쓰는 조건 — 천장에 달리므로 화면 위쪽에 있고,
# 날개가 가로로 퍼져 폭이 높이보다 넓으며, 방 전체를 덮을 만큼 크지는 않다.
FAN_MAX_CENTER_Y_RATIO = 0.45
FAN_MIN_ASPECT = 1.3
FAN_MIN_AREA_RATIO = 0.004
# 실링팬은 사진에서 이보다 크게 잡히지 않는다. 넉넉하게 잡았더니(0.25) 천장 전체가
# "가로로 넓고 위쪽에 있는 후보"로 뽑혀 클릭 시 천장이 통째로 칠해지는 문제가 있었다.
FAN_MAX_AREA_RATIO = 0.10


def _pick_ceiling_fan(
    candidates: list[dict], vision_labels: dict[int, str], width: int, height: int
) -> dict | None:
    """비전 분류가 실패해도 실링팬을 클릭 대상으로 잡아내는 기하학적 폴백.

    Gemini가 과부하/크레딧 문제로 분류에 실패하면 모든 부위가 "~추정" 라벨로만
    남는데, 그러면 정작 사용자가 색을 바꾸고 싶어 하는 실링팬이 문짝 수십 개에
    밀려 클릭 목록에서 잘려나간다. 팬은 '천장(화면 위쪽)에 있고 가로로 넓다'는
    특징이 뚜렷해 이 두 조건만으로도 충분히 골라낼 수 있다."""
    image_area = width * height
    best: dict | None = None
    best_score = 0.0

    for idx, candidate in enumerate(candidates, start=1):
        if vision_labels.get(idx) in ("wall", "ceiling"):
            continue
        x, y, w, h = candidate["bbox"]
        area_ratio = (w * h) / image_area
        if not (FAN_MIN_AREA_RATIO <= area_ratio <= FAN_MAX_AREA_RATIO):
            continue
        center_y_ratio = (y + h / 2) / height
        aspect = w / max(h, 1)
        if center_y_ratio > FAN_MAX_CENTER_Y_RATIO or aspect < FAN_MIN_ASPECT:
            continue
        # 위쪽에 있을수록, 가로로 넓을수록, 그리고 (날개까지 통째로 잡힌 쪽이므로)
        # 면적이 클수록 실링팬일 가능성이 높다 — 면적을 안 보면 SAM이 모터 하우징만
        # 따로 잡은 작은 조각이 뽑혀 날개는 색이 안 바뀐다. 다만 면적 가중치를 크게
        # 주면 천장 같은 넓은 면이 뽑히므로 위치/비율보다 작게(0.5) 반영한다.
        score = (
            (1 - center_y_ratio) + min(aspect, 3.0) / 3.0 + 0.5 * min(area_ratio / FAN_MAX_AREA_RATIO, 1.0)
        )
        if score > best_score:
            best, best_score = candidate, score

    return best


def _build_object_regions(
    candidates: list[dict],
    vision_labels: dict[int, str],
    ceiling: dict | None,
    wall: dict | None,
    category_map: dict[str, str],
    job_id: str,
    width: int,
    height: int,
    fan_candidate: dict | None = None,
    fire_door_ids: set[int] | frozenset[int] = frozenset(),
) -> list[dict]:
    """천장/벽으로 이미 확정된 후보를 제외한 나머지 중, 비전이 의미 있는 카테고리로
    분류한 것은 "상부장 문짝 1", "상부장 문짝 2"처럼 개별 번호를 붙여 각각 독립된
    클릭 대상으로 만든다. 분류에 실패한 나머지도 화면상 위치로 이름을 붙여
    ("상부장 추정 2" 등) 남겨 두어, 인터랙티브 캔버스에 클릭할 거리가 아예
    없어지는 상황을 막는다.

    fire_door_ids는 비전이 방화/현관문으로 판별한 "door" 후보의 번호(후보 순서 기준)다."""
    image_area = width * height
    labeled: list[tuple[dict, str, str]] = []
    leftover: list[dict] = []

    for idx, c in enumerate(candidates, start=1):
        if c is ceiling or c is wall:
            continue
        area_ratio = (c["bbox"][2] * c["bbox"][3]) / image_area
        if not (MIN_MASK_AREA_RATIO <= area_ratio <= MAX_REGION_AREA_RATIO):
            continue

        category_id = vision_labels.get(idx)
        if category_id in category_map and category_id not in ("wall", "ceiling"):
            door_kind = ("fire" if idx in fire_door_ids else "plain") if category_id == "door" else ""
            labeled.append((c, category_id, door_kind))
        elif category_id and category_id != "other":
            continue  # 비전이 벽/천장으로 분류한 후보는 개별 클릭 대상에서 제외
        else:
            leftover.append(c)

    entries: list[dict] = []
    category_counters: dict[str, int] = {}

    # 기하학적으로 찾아낸 실링팬은 비전 분류 성공 여부와 무관하게 항상 첫 번째
    # 클릭 대상으로 넣는다 (이미 비전이 같은 후보를 분류했다면 중복을 피한다).
    if fan_candidate is not None and not any(c is fan_candidate for c, _ in labeled):
        entries.append(
            {
                "candidate": fan_candidate,
                "label": CATEGORY_NAMES["ceiling_fan"],
                "category": "ceiling_fan",
                "is_panel": False,
            }
        )
        leftover = [c for c in leftover if c is not fan_candidate]

    # 실링팬/싱크볼처럼 하나뿐인 설비를 문짝 수십 개에 밀려 잘리지 않게 앞으로 뺀다.
    labeled.sort(key=lambda item: item[1] not in PRIORITY_CATEGORIES)
    for c, category_id, door_kind in labeled:
        base_label = door_label(door_kind) if door_kind else category_map[category_id]
        category_counters[base_label] = category_counters.get(base_label, 0) + 1
        display_label = f"{base_label} {category_counters[base_label]}"
        # 비전이 시공 대상 카테고리로 확정한 부위는 형태 휴리스틱과 무관하게 시공한다.
        entries.append(
            {
                "candidate": c,
                "label": display_label,
                "category": category_id,
                "is_panel": True,
                "door_kind": door_kind,
            }
        )

    # 자동 시공 대상(평평한 패널)을 먼저, 그 외 후보를 나중에 담아 상한(MAX_CLICKABLE_
    # REGIONS)에 걸리더라도 문짝이 먼저 살아남게 한다.
    leftover.sort(key=lambda c: (not c.get("is_panel"), -c["bbox"][2] * c["bbox"][3]))
    fallback_counters: dict[str, int] = {}
    for c in leftover:
        if len(entries) >= MAX_CLICKABLE_REGIONS:
            break
        name = _positional_label(c, height)
        fallback_counters[name] = fallback_counters.get(name, 0) + 1
        entries.append(
            {
                "candidate": c,
                "label": f"{name} {fallback_counters[name]}",
                "category": "other",
                "is_panel": bool(c.get("is_panel")),
            }
        )

    entries = entries[:MAX_CLICKABLE_REGIONS]

    regions = []
    for i, entry in enumerate(entries, start=1):
        try:
            if entry["category"] == "ceiling_fan":
                # 실링팬은 SAM이 모터 하우징과 날개를 따로 잡는 경우가 많아, 허브
                # 주변 조각들을 합쳐 팬 전체를 하나의 클릭 대상으로 만든다.
                mask_path, bbox = _merge_fan_parts(candidates, entry["candidate"], job_id, i)
            else:
                mask_path = _download_mask(entry["candidate"]["mask_url"], job_id, f"obj{i}")
                bbox = entry["candidate"]["bbox"]
        except Exception:
            continue
        x, y, w, h = bbox
        region = {
            "id": f"obj-{i}",
            "label": entry["label"],
            "category": entry["category"],
            "bbox": [x, y, w, h],
            "mask_path": mask_path,
            "is_panel": entry["is_panel"],
        }
        if entry.get("door_kind"):
            region["door_kind"] = entry["door_kind"]
        regions.append(region)
    return regions


# 허브 bbox를 이만큼 키운 범위 안에 중심이 들어오는 후보를 "같은 팬의 날개"로 본다.
# 날개는 허브를 중심으로 방사형으로 뻗으므로 가로로 넉넉히, 세로로는 조금만 키운다.
FAN_MERGE_EXPAND_X = 2.6
FAN_MERGE_EXPAND_Y = 2.0
# 합쳐 넣을 조각 하나의 최대 크기(이미지 대비)와, 합친 결과가 허브 대비 커질 수 있는
# 최대 배수. 이 두 가지가 없으면 천장 같은 넓은 면이 "날개"로 딸려 들어와 클릭 시
# 천장 전체가 칠해진다(실측: 팬 마스크가 1020x425까지 부풀어 천장이 통째로 검게 칠해짐).
FAN_MERGE_MAX_PART_AREA_RATIO = 0.05
FAN_MERGE_MAX_TOTAL_GROWTH = 3.0


def _merge_fan_parts(
    candidates: list[dict], hub: dict, job_id: str, index: int
) -> tuple[str, tuple[int, int, int, int]]:
    """실링팬 허브 주변의 날개 조각 마스크를 합쳐 팬 전체 마스크를 만들고 저장한다.

    SAM은 실링팬을 통째로 잡아주지 않고 모터 하우징만 따로 분리해내는 경우가 많다
    (실측: 팬 전체가 아니라 200x58px짜리 허브만 잡혔다). 그 마스크만 쓰면 클릭해서
    색을 바꿔도 날개는 흰색 그대로 남는다. 허브를 중심으로 한 확대 영역 안에 중심이
    들어오는 다른 후보들을 날개로 보고 함께 합친다."""
    hx, hy, hw, hh = hub["bbox"]
    cx, cy = hx + hw / 2, hy + hh / 2
    half_w = hw * FAN_MERGE_EXPAND_X / 2
    half_h = hh * FAN_MERGE_EXPAND_Y / 2

    hub_mask_path = _download_mask(hub["mask_url"], job_id, f"obj{index}p0")
    hub_arr = np.array(Image.open(hub_mask_path).convert("L")) > 127
    hub_area = int(hub_arr.sum())
    image_area = hub_arr.shape[0] * hub_arr.shape[1]

    mask_paths = [hub_mask_path]
    for part_index, candidate in enumerate(candidates, start=1):
        if candidate is hub:
            continue
        x, y, w, h = candidate["bbox"]
        # 팬보다 훨씬 큰 후보(천장 전체 등)가 섞이면 마스크가 통째로 커지므로 제외한다.
        if (w * h) / image_area > FAN_MERGE_MAX_PART_AREA_RATIO:
            continue
        px, py = x + w / 2, y + h / 2
        if abs(px - cx) <= half_w and abs(py - cy) <= half_h:
            try:
                mask_paths.append(_download_mask(candidate["mask_url"], job_id, f"obj{index}p{part_index}"))
            except Exception:
                continue

    merged = combine_masks(mask_paths)
    merged_area = (np.array(merged.convert("L")) > 127).sum()
    # 합친 결과가 허브보다 지나치게 커졌다면 날개가 아니라 넓은 면이 섞인 것이므로
    # 안전하게 허브 마스크만 쓴다 (팬만 정확히 칠하는 쪽이 천장을 망치는 것보다 낫다).
    if hub_area > 0 and merged_area > hub_area * FAN_MERGE_MAX_TOTAL_GROWTH:
        merged = Image.open(hub_mask_path).convert("L")

    merged_path = f"storage/uploads/{job_id}_obj{index}_mask.png"
    merged.save(merged_path)

    arr = np.array(merged.convert("L")) > 127
    ys, xs = np.nonzero(arr)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min()), int(ys.max() - ys.min()))
    return merged_path, bbox


def _positional_label(candidate: dict, height: int) -> str:
    """Gemini 분류를 못 쓸 때(키 미설정/크레딧 소진 등) 화면상 세로 위치로 이름을
    붙인다. "부위 7"보다 "상부장 추정 2"가 어느 문짝인지 훨씬 빨리 찾을 수 있다.
    분류가 아니라 위치 기반 추정이므로 이름에 "추정"을 붙여 혼동을 막는다."""
    _x, y, _w, h = candidate["bbox"]
    center_ratio = (y + h / 2) / height
    if center_ratio < 0.45:
        return "상부장 추정"
    if center_ratio < 0.62:
        return "중단 부위 추정"
    return "하부장 추정"


def _download_mask(mask_url: str, job_id: str, label: str) -> str:
    response = httpx.get(mask_url, timeout=30)
    response.raise_for_status()
    path = f"storage/uploads/{job_id}_{label}_mask.png"
    with open(path, "wb") as f:
        f.write(response.content)
    return path


def _save_rect_mask(
    width: int, height: int, x0: int, y0: int, x1: int, y1: int, job_id: str, label: str
) -> str:
    """SAM이 넓은 면(천장/벽)을 통째로 잡아내지 못했을 때 쓰는 기하학적 추정 마스크."""
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rectangle([x0, y0, x1, y1], fill=255)
    path = f"storage/uploads/{job_id}_{label}_mask.png"
    mask.save(path)
    return path
