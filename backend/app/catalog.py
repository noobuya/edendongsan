"""시공 항목별 카탈로그(패턴/제품/옵션) 정의.
가격 자체는 app/services/estimator.py의 PRICE_TABLE에 있고,
여기서는 UI 셀렉트에 노출되는 옵션 메타데이터(이름/색상/썸네일 등)만 다룬다.
"""

WORK_ITEMS = {
    "film": {"id": "film", "name": "인테리어 필름"},
    "sash": {"id": "sash", "name": "샷시 필름"},
    "glass": {"id": "glass", "name": "유리 썬팅"},
    "lighting": {"id": "lighting", "name": "조명/다운라이트"},
    "fan": {"id": "fan", "name": "실링팬"},
    "sink": {"id": "sink", "name": "싱크볼 교체"},
    "door_frame": {"id": "door_frame", "name": "문짝/문틀 시공"},
    "mesh_screen": {"id": "mesh_screen", "name": "미세방충망"},
    "toilet": {"id": "toilet", "name": "변기 설치"},
    "wardrobe": {"id": "wardrobe", "name": "장롱/옷장"},
    "wall_film": {"id": "wall_film", "name": "벽면 시트지"},
    "illustration": {"id": "illustration", "name": "일러스트 (사장님 전용)"},
}

# 미세방충망 원단 종류. 촘촘할수록 벌레는 잘 막지만 바람이 덜 통한다.
MESH_TYPES = {
    "fine_20": {"name": "미세방충망 (20메시)", "prompt_keyword": "fine mesh insect screen"},
    "ultra_30": {"name": "초미세방충망 (30메시)", "prompt_keyword": "ultra fine mesh insect screen"},
    "pet_proof": {"name": "펫 방충망 (강화)", "prompt_keyword": "heavy duty pet resistant mesh screen"},
}

# 변기 등급. 철거·급수 연결은 어느 것이나 같아서 본체 값만 다르다.
TOILET_SPECS = {
    "standard": {"name": "일반형 투피스 변기", "prompt_keyword": "standard two piece white toilet"},
    "one_piece": {"name": "원피스 변기", "prompt_keyword": "modern one piece white toilet"},
    "bidet_combo": {"name": "비데 일체형 변기", "prompt_keyword": "integrated bidet smart toilet"},
}

GLASS_TINT_TYPES = {
    "clear": {"name": "투명 (자외선 차단)", "prompt_keyword": "clear transparent UV window film"},
    "frosted": {"name": "반투명 (불투명 시야차단)", "prompt_keyword": "frosted translucent privacy window film"},
    "mirror": {"name": "미러 (반사)", "prompt_keyword": "mirrored reflective window film"},
    "blackout": {"name": "블랙아웃 (암막)", "prompt_keyword": "dark blackout window film"},
}

# color_hex는 프론트엔드 lib/patternSwatches.ts 의 값과 반드시 동일하게 유지한다.
# prompt_keyword는 SDXL 인페인팅(app/services/inpainting.py)에 넘기는 영문 소재 설명이다.
PATTERNS = {
    "matte-white": {
        "name": "매트 화이트",
        "color_hex": "#F2F1ED",
        "texture_path": "assets/patterns/matte-white.png",
        "prompt_keyword": "matte white interior film finish",
    },
    "cream-white": {
        "name": "크림 화이트",
        "color_hex": "#F5EEDC",
        "texture_path": "assets/patterns/cream-white.png",
        "prompt_keyword": "cream white interior film finish",
    },
    "light-gray": {
        "name": "라이트 그레이",
        "color_hex": "#C7CBCE",
        "texture_path": "assets/patterns/light-gray.png",
        "prompt_keyword": "light gray matte interior film finish",
    },
    "dark-gray": {
        "name": "다크 그레이",
        "color_hex": "#55585C",
        "texture_path": "assets/patterns/dark-gray.png",
        "prompt_keyword": "dark gray matte interior film finish",
    },
    "matte-black": {
        "name": "매트 블랙",
        "color_hex": "#2B2B2E",
        "texture_path": "assets/patterns/matte-black.png",
        "prompt_keyword": "matte black interior film finish",
    },
    "oak-wood": {
        "name": "오크 우드",
        "color_hex": "#B08B5A",
        "texture_path": "assets/patterns/oak-wood.png",
        "prompt_keyword": "natural oak wood grain interior film finish",
        "wood_grain": True,
    },
    "walnut-wood": {
        "name": "월넛 우드",
        "color_hex": "#5C3A28",
        "texture_path": "assets/patterns/walnut-wood.png",
        "prompt_keyword": "dark walnut wood grain interior film finish",
        "wood_grain": True,
    },
    "deep-navy": {
        "name": "딥 네이비",
        "color_hex": "#1F2A44",
        "texture_path": "assets/patterns/deep-navy.png",
        "prompt_keyword": "matte deep navy interior film finish",
    },
    "olive-green": {
        "name": "올리브 그린",
        "color_hex": "#6B6B3A",
        "texture_path": "assets/patterns/olive-green.png",
        "prompt_keyword": "matte olive green interior film finish",
    },
    "warm-beige": {
        "name": "웜 베이지",
        "color_hex": "#D9C7AC",
        "texture_path": "assets/patterns/warm-beige.png",
        "prompt_keyword": "warm beige matte interior film finish",
    },
    # [현대보닥(BODAQ) 실제 샘플 카탈로그]
    # 위 10개는 "매트 화이트"처럼 일반명뿐이라 실제 발주할 때 어느 제품인지 알 수 없었다.
    # 여기부터는 현대L&C 보닥(bodaq.com) 공식 카탈로그의 실제 제품코드·컬러명을 그대로
    # 쓴다 — 시공자가 화면에서 고른 색을 그대로 자재 발주서에 옮길 수 있어야 한다.
    # (색상 hex는 공식 사이트가 hex 값을 공개하지 않아 컬러명을 보고 근사치로 잡은
    # 값이다 — 화면 스와치·리컬러 폴백용이고, 실제 렌더링은 prompt_keyword가 정확한
    # 톤을 결정한다. 기존 10개와 id를 겹치지 않게 "bodaq-" 접두사를 붙여, 이미 저장된
    # 옛 견적서의 옵션 id가 깨지지 않는다.)
    "bodaq-s261": {
        "name": "딥 슬레이트 (BODAQ S261)",
        "color_hex": "#3A4048",
        "prompt_keyword": "deep slate grey-blue matte interior film finish",
    },
    "bodaq-s262": {
        "name": "애시 그레이 (BODAQ S262)",
        "color_hex": "#A9A9A2",
        "prompt_keyword": "ash grey matte interior film finish",
    },
    "bodaq-s263": {
        "name": "실버 미스트 (BODAQ S263)",
        "color_hex": "#C9CCCE",
        "prompt_keyword": "silver mist light grey matte interior film finish",
    },
    "bodaq-s264": {
        "name": "페블 그레이 (BODAQ S264)",
        "color_hex": "#B9B4AC",
        "prompt_keyword": "pebble grey warm matte interior film finish",
    },
    "bodaq-s265": {
        "name": "옵시디언 블루 (BODAQ S265)",
        "color_hex": "#1C2430",
        "prompt_keyword": "obsidian deep blue-black matte interior film finish",
    },
    "bodaq-s266": {
        "name": "딥 포레스트 (BODAQ S266)",
        "color_hex": "#21382C",
        "prompt_keyword": "deep forest green matte interior film finish",
    },
    "bodaq-blc05": {
        "name": "퓨어 화이트 (BODAQ BLC05)",
        "color_hex": "#FAFAF7",
        "prompt_keyword": "pure white premium matte interior film finish",
    },
    "bodaq-smt02": {
        "name": "웜 에크루 (BODAQ SMT02)",
        "color_hex": "#DCCBA8",
        "prompt_keyword": "warm ecru super matte interior film finish",
    },
    "bodaq-smt04": {
        "name": "드라이드 세이지 (BODAQ SMT04)",
        "color_hex": "#8C9575",
        "prompt_keyword": "dried sage green super matte interior film finish",
    },
    "bodaq-w015": {
        "name": "헤리티지 골든 오크 (BODAQ W015)",
        "color_hex": "#B98A4E",
        "prompt_keyword": "heritage golden oak wood grain interior film finish",
        "wood_grain": True,
    },
    "bodaq-w141": {
        "name": "리치 월넛 (BODAQ W141)",
        "color_hex": "#4A2F22",
        "prompt_keyword": "rich walnut dark wood grain interior film finish",
        "wood_grain": True,
    },
    "bodaq-w883": {
        "name": "에스프레소 로스트 오크 (BODAQ W883)",
        "color_hex": "#3B2A20",
        "prompt_keyword": "espresso roast dark oak wood grain interior film finish",
        "wood_grain": True,
    },
    "bodaq-w956": {
        "name": "드리프트우드 오크 (BODAQ W956)",
        "color_hex": "#B8A891",
        "prompt_keyword": "driftwood grey-tan oak wood grain interior film finish",
        "wood_grain": True,
    },
    "bodaq-w011": {
        "name": "화이트워시드 오크 (BODAQ W011)",
        "color_hex": "#E4DBC9",
        "prompt_keyword": "whitewashed light oak wood grain interior film finish",
        "wood_grain": True,
    },
}

# 화면에서 "브랜드별로 묶어" 보여주기 위한 그룹 메타데이터. PATTERNS 자체는 평평한
# dict로 두고(id로 바로 찾아 써야 하는 곳이 많다), 이 표는 순서·구분선만 담당한다.
PATTERN_GROUPS = [
    {"id": "basic", "label": "기본 색상", "pattern_ids": [
        "matte-white", "cream-white", "light-gray", "dark-gray", "matte-black",
        "oak-wood", "walnut-wood", "deep-navy", "olive-green", "warm-beige",
    ]},
    {"id": "bodaq", "label": "현대보닥 (BODAQ)", "pattern_ids": [
        "bodaq-s261", "bodaq-s262", "bodaq-s263", "bodaq-s264", "bodaq-s265", "bodaq-s266",
        "bodaq-blc05", "bodaq-smt02", "bodaq-smt04",
        "bodaq-w015", "bodaq-w141", "bodaq-w883", "bodaq-w956", "bodaq-w011",
    ]},
]

# 실링팬 날개 색상 프롬프트. PATTERNS의 prompt_keyword는 "interior film finish"처럼
# 필름 시공 문구가 붙어 있어 그대로 쓰면 "매트 네이비 필름이 발린 실링팬"처럼
# 어색한 문장이 되므로, 색상 형용사만 따로 뽑아둔다. 실링팬 색상은 PATTERNS와
# 같은 색상 팔레트(SwatchPicker)를 그대로 재사용해 사용자에게 익숙한 선택지를 준다.
FAN_BLADE_COLOR_PROMPTS = {
    "matte-white": "matte white",
    "cream-white": "cream white",
    "light-gray": "light gray",
    "dark-gray": "dark gray",
    "matte-black": "matte black",
    "oak-wood": "natural oak wood grain",
    "walnut-wood": "dark walnut wood grain",
    "deep-navy": "matte deep navy",
    "olive-green": "matte olive green",
    "warm-beige": "warm beige",
}

FIXTURE_PRODUCTS = {
    "ceiling_fan_basic": "assets/fixtures/ceiling_fan_basic.png",
    "downlight_basic": "assets/fixtures/downlight_basic.png",
}

CEILING_REINFORCEMENT_TYPES = {
    "gypsum": {"name": "석고보드"},
    "concrete": {"name": "콘크리트"},
    "wood_reinforced": {"name": "목공 보강"},
}

LIGHTING_INCH_OPTIONS = {
    "3": {"name": "3인치"},
    "4": {"name": "4인치"},
    "5": {"name": "5인치"},
}

SINK_BOWL_SPECS = {
    "standard_850": {"name": "기본형 사각 싱크볼 (850)", "prompt_keyword": "standard rectangular stainless steel kitchen sink"},
    "standard_860": {"name": "기본형 사각 싱크볼 (860)", "prompt_keyword": "standard rectangular stainless steel kitchen sink"},
    "premium_square": {"name": "고급 사각 싱크볼", "prompt_keyword": "premium large square undermount kitchen sink"},
}

FAUCET_TYPES = {
    "none": {"name": "수전 교체 없음", "prompt_keyword": ""},
    "waterfall": {"name": "폭포 수전", "prompt_keyword": "with a modern waterfall faucet"},
    "gooseneck": {"name": "거위목 수전", "prompt_keyword": "with a tall gooseneck faucet"},
}

DRAIN_TYPES = {
    "stainless_basic": {"name": "스텐 배수구", "prompt_keyword": "stainless steel drain"},
}


# --- 수동 모드(구역 지정) 영문 기본 프롬프트 -----------------------------------
# 수동 모드는 사용자가 고른 항목의 한글 표시명("실링팬 (블랙)")을 그대로 프롬프트로
# 보내고 있었다. SDXL은 한글을 거의 이해하지 못해 자재가 제대로 반영되지 않고,
# 커스텀 요청을 "a 빈티지 우드 실링팬 (블랙)"처럼 합성해도 의미가 서지 않는다.
# 여기서 항목 id를 영문 명사구로 바꿔 준다.
MANUAL_OPTION_PROMPTS: dict[str, dict[str, str]] = {
    "film": {k: v["prompt_keyword"] for k, v in PATTERNS.items()},
    # 샷시는 같은 색 팔레트를 쓰지만 대상이 창틀/문틀이다.
    "sash": {
        "matte-white": "matte white window frame wrapping film",
        "matte-black": "matte black window frame wrapping film",
        "dark-gray": "dark gray matte window frame wrapping film",
    },
    "glass": {k: v["prompt_keyword"] for k, v in GLASS_TINT_TYPES.items()},
    "lighting": {
        "downlight_4": "4 inch recessed LED downlight",
        "downlight_6": "6 inch recessed LED downlight",
    },
    "fan": {
        "ceiling_fan_black": "matte black ceiling fan",
        "ceiling_fan_white": "matte white ceiling fan",
        "ceiling_fan_wood": "natural oak wood ceiling fan",
    },
    "door_frame": {
        "matte-white": "matte white door and door frame wrapping film",
        "matte-black": "matte black door and door frame wrapping film",
        "oak-wood": "natural oak wood grain door and door frame wrapping film",
        "walnut-wood": "dark walnut wood grain door and door frame wrapping film",
    },
    "wall_film": {k: v["prompt_keyword"].replace("interior film finish", "wall covering film")
                  for k, v in PATTERNS.items()},
    "wardrobe": {
        "matte-white": "matte white wardrobe door wrapping film",
        "cream-white": "cream white wardrobe door wrapping film",
        "matte-black": "matte black wardrobe door wrapping film",
        "oak-wood": "natural oak wood grain wardrobe door wrapping film",
        "walnut-wood": "dark walnut wood grain wardrobe door wrapping film",
    },
    "mesh_screen": {k: v["prompt_keyword"] for k, v in MESH_TYPES.items()},
    "toilet": {k: v["prompt_keyword"] for k, v in TOILET_SPECS.items()},
    "sink": {
        "standard_850": SINK_BOWL_SPECS["standard_850"]["prompt_keyword"],
        "standard_860": SINK_BOWL_SPECS["standard_860"]["prompt_keyword"],
        "premium_square": SINK_BOWL_SPECS["premium_square"]["prompt_keyword"],
        "wide_1200": "wide 1200mm stainless steel kitchen sink",
    },
}

# 항목은 아는데 세부 옵션을 모를 때 쓰는 종목별 기본 명사.
MANUAL_CATEGORY_PROMPTS = {
    "film": "interior film finish",
    "sash": "window frame wrapping film",
    "glass": "window film",
    "lighting": "recessed LED downlight",
    "fan": "ceiling fan",
    "sink": "stainless steel kitchen sink",
    "door_frame": "door and door frame wrapping film",
    "mesh_screen": "fine mesh insect screen",
    "toilet": "white ceramic toilet",
    "wardrobe": "wardrobe door wrapping film",
    "wall_film": "wall covering film",
}


def manual_base_prompt(category: str, option: str, fallback: str = "") -> str:
    """수동 구역의 항목·옵션을 SDXL이 알아듣는 영문 명사구로 바꾼다.

    모르는 조합이면 종목 기본값 -> 사용자에게 보여준 한글 이름 순으로 물러선다.
    한글이라도 아무것도 없는 것보다는 낫기 때문이다."""
    by_option = MANUAL_OPTION_PROMPTS.get(category, {})
    return by_option.get(option) or MANUAL_CATEGORY_PROMPTS.get(category) or fallback
