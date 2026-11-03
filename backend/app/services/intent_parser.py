"""말(받아쓰기)이나 텍스트로 설명한 시공 범위를 구조화된 항목·기본 치수로 바꾼다.

사장님이 "30평대 싱크대 상하부장과 아일랜드를 시공할거다"처럼 말하면, 이 모듈이
Gemini로 "어떤 항목을 켤지"만 가볍게 판정하고(불리언 플래그), 실제 가로·세로·개수는
이 파일의 표준 기본값으로 채운다 — 사진만으로는 실측을 알 수 없어서다. 이 기본값은
제출 전 확인 화면에서 사장님이 그대로 두거나 고칠 수 있는 "초안"이지 확정 견적이
아니다.

[중요] 실제 시공 영역은 이 모듈과 무관하게 segmentation.py의 자동 인식(SAM+Gemini
Vision)이 사진에서 그대로 찾는다 — 여기서 하는 일은 "어느 카테고리를 찾아 시공할지"
범위를 정하는 것뿐이다. 그래서 "싱크대 상하부장만" 켰는데 엉뚱하게 옷장까지
시공되는 일은 없다(파이프라인은 켜진 카테고리만 대상으로 삼는다 — pipeline.py의
_film_target_phrases 참고).
"""
import json

from google import genai
from google.genai import types

from app.config import get_settings
from app.services.timeouts import run_gemini_with_retry

INTENT_TIMEOUT_S = 20
# "-latest" 별칭을 써서 구글이 특정 세대 모델을 폐기해도 코드 수정 없이 넘어간다
# (vision_client.py와 같은 이유).
GEMINI_MODEL = "gemini-flash-latest"

# Gemini에게 묻는 항목 하나하나 — (WorkItemId, 패널 하위 필드, 한국어 설명).
# 하위 필드 이름은 types/index.ts의 JobOptionsState 필드명(camelCase로 변환 전,
# snake_case)과 1:1로 맞춰 둬서 _to_camel()로 그대로 변환하면 프런트 타입과
# 어긋나지 않는다.
INTENT_FLAGS: list[tuple[str, str, str]] = [
    ("film", "upper_cabinets", "주방 상부장 문짝"),
    ("film", "lower_cabinets", "주방 하부장 문짝"),
    ("film", "island_tables", "주방 아일랜드 식탁"),
    ("film", "doors", "방문 — 상하부장 등 다른 필름 부위와 '함께' 언급됐을 때만"),
    ("film", "doorframes", "문틀 — 상하부장 등 다른 필름 부위와 '함께' 언급됐을 때만"),
    ("film", "fridge_cabinets", "냉장고장"),
    ("film", "pantry_cabinets", "팬트리장"),
    ("film", "shoe_cabinets", "신발장"),
    ("wardrobe", "doors", "옷장/장롱 문짝"),
    ("wardrobe", "bodies", "옷장/장롱 몸통(측판·천판)"),
    ("door_frame", "doors", "방문 — 문짝·문틀만 단독으로 의뢰받았을 때(기본값)"),
    ("door_frame", "doorframes", "문틀 — 문짝·문틀만 단독으로 의뢰받았을 때(기본값)"),
    ("sash", "frames", "창틀(샷시)"),
    ("wall_film", "walls", "벽면 시트지"),
    ("mesh_screen", "screens", "미세방충망"),
    ("glass", "panels", "유리문/유리창 썬팅"),
]

# 패널 목록 없이 "켜기/끄기"만으로 충분한 항목 — 실제 개수(조명 1대 vs 5대 등)는
# 사람이 다음 화면에서 직접 넣는다. AI가 말에서 정확한 개수를 뽑아내려다 틀리는
# 것보다, 일단 항목만 켜고 "몇 개?"를 사람에게 묻는 쪽이 안전하다.
SCALAR_ITEMS: list[tuple[str, str]] = [
    ("lighting", "조명/다운라이트"),
    ("fan", "실링팬"),
    ("sink", "싱크볼 교체"),
    ("toilet", "변기"),
    ("furniture", "가구(의자·책상·책꽂이 등)"),
]

# 항목별 "표준" 가로×세로(mm) — 실측이 아니라 업계 평균 참고치다. 치수는 평수와
# 무관하게 고정하고, 개수만 DEFAULT_COUNT_BY_SIZE로 집 크기에 맞춰 보정한다.
DEFAULT_PANEL_MM: dict[tuple[str, str], tuple[int, int]] = {
    ("film", "upper_cabinets"): (600, 700),
    ("film", "lower_cabinets"): (600, 700),
    ("film", "island_tables"): (2400, 900),
    ("film", "doors"): (900, 2000),
    ("film", "doorframes"): (900, 2000),
    ("film", "fridge_cabinets"): (700, 2000),
    ("film", "pantry_cabinets"): (600, 2000),
    ("film", "shoe_cabinets"): (1200, 1200),
    ("wardrobe", "doors"): (600, 2200),
    ("wardrobe", "bodies"): (600, 2200),
    ("door_frame", "doors"): (900, 2000),
    ("door_frame", "doorframes"): (900, 2000),
    ("sash", "frames"): (1500, 1200),
    ("wall_film", "walls"): (3000, 2400),
    ("mesh_screen", "screens"): (1000, 1200),
    ("glass", "panels"): (900, 2000),
}
DEFAULT_COUNT_BY_SIZE: dict[tuple[str, str], dict[str, int]] = {
    ("film", "upper_cabinets"): {"small": 4, "medium": 6, "large": 8},
    ("film", "lower_cabinets"): {"small": 4, "medium": 6, "large": 8},
    ("film", "island_tables"): {"small": 1, "medium": 1, "large": 1},
    ("film", "doors"): {"small": 1, "medium": 1, "large": 1},
    ("film", "doorframes"): {"small": 1, "medium": 1, "large": 1},
    ("film", "fridge_cabinets"): {"small": 1, "medium": 1, "large": 1},
    ("film", "pantry_cabinets"): {"small": 1, "medium": 1, "large": 1},
    ("film", "shoe_cabinets"): {"small": 1, "medium": 1, "large": 1},
    ("wardrobe", "doors"): {"small": 2, "medium": 3, "large": 4},
    ("wardrobe", "bodies"): {"small": 1, "medium": 1, "large": 2},
    ("door_frame", "doors"): {"small": 1, "medium": 1, "large": 1},
    ("door_frame", "doorframes"): {"small": 1, "medium": 1, "large": 1},
    ("sash", "frames"): {"small": 1, "medium": 2, "large": 3},
    ("wall_film", "walls"): {"small": 1, "medium": 1, "large": 1},
    ("mesh_screen", "screens"): {"small": 1, "medium": 2, "large": 3},
    ("glass", "panels"): {"small": 1, "medium": 1, "large": 1},
}


def _size_tier(pyeong: float | None) -> str:
    if pyeong is None:
        return "medium"
    if pyeong <= 20:
        return "small"
    if pyeong <= 35:
        return "medium"
    return "large"


def _to_camel(snake: str) -> str:
    head, *rest = snake.split("_")
    return head + "".join(w.capitalize() for w in rest)


def _build_prompt() -> str:
    flag_lines = "\n".join(f'- "{item}_{sub}": {desc}' for item, sub, desc in INTENT_FLAGS)
    scalar_lines = "\n".join(f'- "{item}": {desc}' for item, desc in SCALAR_ITEMS)
    bool_keys = ", ".join(f'"{item}_{sub}": boolean' for item, sub, _ in INTENT_FLAGS)
    bool_keys += ", " + ", ".join(f'"{item}": boolean' for item, _ in SCALAR_ITEMS)
    return (
        "인테리어 필름 시공 기사가 사장님에게 구두로 들은 작업 범위를 아래 항목들에 "
        "매칭해 JSON으로만 답하라. 말한 적 없거나 확실하지 않은 항목은 반드시 "
        "false로 둔다(짐작해서 켜지 말 것) — 켜진 항목은 사진에서 실제로 찾아 "
        "시공된다.\n\n"
        "방문/문틀 주의: '문짝과 문틀을 시공할거다'처럼 문짝·문틀만 단독으로 "
        "말했으면 door_frame_doors/door_frame_doorframes를 켠다(문짝/문틀 "
        "전문 종목 — 견적서에 따로 항목이 나와야 해서다). '싱크대 상하부장이랑 "
        "방문도 같이' 처럼 다른 필름 부위와 함께 섞어 말했을 때만 "
        "film_doors/film_doorframes를 켠다.\n\n"
        "불리언 항목(해당하면 true, 아니면 false):\n" + flag_lines + "\n" + scalar_lines + "\n\n"
        '"평수"처럼 집 크기를 말했으면 size_hint_pyeong에 숫자(평)만 담고, 없으면 '
        "null로 둔다.\n"
        "시공 범위를 전혀 알아들을 수 없거나 무관한 말이면(예: 잡담, 질문) "
        "unclear_note에 원문을 그대로 담고 다른 모든 불리언 필드는 false로 둔다. "
        "이해했으면 unclear_note는 null.\n\n"
        f"JSON 형식: {{{bool_keys}, \"size_hint_pyeong\": number|null, "
        '"unclear_note": string|null}'
    )


_EMPTY_RESULT = {"items": [], "panels": {}, "unclear_note": None}


def parse_construction_intent(text: str) -> dict:
    """사장님 발화(text) 한 문장을 받아 프런트가 바로 쓸 수 있는 구조로 돌려준다.

    반환 모양(ConstructionIntentResponse와 동일):
      {
        "items": ["film", "wardrobe", ...],                  # 켤 WorkItemId 목록
        "panels": {"film": {"upperCabinets": [...]}, ...},   # 패널형 항목의 초안 치수
        "unclear_note": str | None,                          # 이해 못 했으면 원문
      }

    Gemini 키가 없거나 호출이 실패해도 예외를 올리지 않고 "이해 못 함"으로 돌려준다
    — 프런트가 그 경우 자연스럽게 기존 "직접 선택" 화면으로 안내한다."""
    settings = get_settings()
    stripped = text.strip()
    if not stripped:
        return {**_EMPTY_RESULT, "unclear_note": ""}
    if not settings.gemini_api_key:
        return {**_EMPTY_RESULT, "unclear_note": stripped}

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = run_gemini_with_retry(
            client.models.generate_content,
            INTENT_TIMEOUT_S,
            model=GEMINI_MODEL,
            contents=[_build_prompt(), f'사장님 말: "{stripped}"'],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        data = json.loads(response.text)
    except Exception as exc:
        print(f"[intent_parser] Gemini 호출 실패, 이해 못 한 것으로 처리: {exc}")
        return {**_EMPTY_RESULT, "unclear_note": stripped}

    if data.get("unclear_note"):
        return {**_EMPTY_RESULT, "unclear_note": str(data["unclear_note"])}

    tier = _size_tier(data.get("size_hint_pyeong"))

    items: list[str] = []
    panels: dict[str, dict[str, list[dict]]] = {}
    seen: set[str] = set()
    for item, sub, _ in INTENT_FLAGS:
        if not data.get(f"{item}_{sub}"):
            continue
        if item not in seen:
            items.append(item)
            seen.add(item)
        width, height = DEFAULT_PANEL_MM[(item, sub)]
        count = DEFAULT_COUNT_BY_SIZE[(item, sub)][tier]
        panels.setdefault(item, {})[_to_camel(sub)] = [
            {"widthMm": width, "heightMm": height, "count": count}
        ]

    for item, _ in SCALAR_ITEMS:
        if data.get(item) and item not in seen:
            items.append(item)
            seen.add(item)

    return {"items": items, "panels": panels, "unclear_note": None}
