"""견적 단가(공임·재료비·요율)의 기준값과, 사장님이 조정한 값을 보관한다.

기준값은 코드에 두고, 조정한 값만 storage/pricing.json에 덮어쓰기로 쌓는다.
이렇게 하면 나중에 기준값을 코드에서 고쳐도 사장님이 바꾼 항목은 그대로 유지되고,
"기본값으로 되돌리기"도 그 항목만 지우면 끝난다.

현장 단가는 지역·시기·거래처에 따라 달라지므로, 프로그램을 다시 배포하지 않고
앱에서 바로 고칠 수 있어야 한다(에덴동산 배너 길게 누르기 → 단가 설정).
"""
import copy
import json
import os

PRICING_PATH = "storage/pricing.json"

DEFAULT_PRICING: dict = {
    "manday_rate": 250_000,  # 1품(man-day) 인건비
    "loss_rate_percent": 15.0,  # 자재 로스율
    "vat_rate_percent": 10.0,
    "price_table": {
        # 문짝 구조별 인건비 난이도 할증 배수. 알판/격자문은 세로 기둥·가로대·알판을
        # 따로 재단해 겹쳐 붙이는 덧방 시공이라 민짜문(통판 한 장)보다 2~3배 오래
        # 걸린다 — 인건비에서만 이 배수를 곱한다(원단 소요량은 그대로 실측 면적).
        # door_frame/film(방문)/wardrobe(옷장 문짝) 세 곳의 "문짝" 인건비 산출이
        # 공통으로 이 표를 참조한다.
        "door_difficulty_multiplier": {"lattice": 1.75, "glass": 1.5},
        "film": {
            "primer_per_m2": 3_000,
            # 1품당 처리 가능한 면적(㎡, 몰딩은 길이 m) — 난이도가 높을수록 작게 잡는다.
            # [싱크대장은 4.5㎡/품으로 잡는 이유]
            # 상·하부장은 손잡이·경첩 탈거, 기존 실리콘 제거, 퍼티 평탄화, 프라이머까지 하는
            # 밑작업이 붙어 실제로는 붙이는 시간보다 준비하는 시간이 길다. 15㎡/품으로 잡으면
            # 싱크대 한 벌(약 9.6㎡)이 0.64품(16만 원)으로 나와 원단값(9만 원) 포함 25만 원대가
            # 되는데, 현장 실제 견적은 60만 원 안팎이다(필름 1만 원/m 기준). 9.6㎡를 하루 반
            # 정도(2품 남짓)로 보는 값이다.
            "manday_coverage": {
                "upper_cabinet_m2": 4.5,
                "lower_cabinet_m2": 4.5,
                "island_table_m2": 3.5,
                "door_m2": 12.0,
                "doorframe_m2": 8.0,
                "tall_cabinet_m2": 4.5,
                "molding_m": 30.0,
            },
        },
        "sash": {"primer_per_m2": 3_000, "manday_coverage": {"sash_m2": 7.0}},
        # 문짝/문틀은 인테리어 필름과 같은 원단을 쓰지만 별도 종목이다.
        # 문짝은 평평해 넓게 붙고(1품 12㎡), 문틀은 모서리가 많아 훨씬 더디다(1품 8㎡).
        "door_frame": {
            "primer_per_m2": 3_000,
            "hardware_per_door": 8_000,  # 손잡이/경첩 탈부착 부자재
            "manday_coverage": {"door_m2": 12.0, "doorframe_m2": 8.0},
        },
        "glass": {
            "tint_material_per_m2": {
                "clear": 25_000,
                "frosted": 30_000,
                "mirror": 45_000,
                "blackout": 35_000,
            },
            "tint_manday_m2": 12.0,
            "illust_per_unit": 50_000,
        },
        "lighting": {
            "unit_price_by_inch": {"3": 12_000, "4": 15_000, "5": 19_000},
            "labor_per_unit": 10_000,
            "drilling_new_per_unit": 8_000,
            "wiring_per_m": 6_000,
        },
        "fan": {
            "unit_price": 180_000,
            "labor_per_unit": 60_000,
            "reinforcement_per_m2": {"gypsum": 15_000, "concrete": 35_000, "wood_reinforced": 25_000},
            "height_surcharge_per_m": 15_000,
            "height_base_m": 2.4,
        },
        # 벽면: 넓고 평평해 1품에 많이 붙는다(16㎡). 다만 벽지 위 시공이면
        # 면처리(프라이머)를 안 하면 들뜨므로 기본으로 켜 둔다.
        "wall_film": {"primer_per_m2": 3_000, "manday_coverage": {"wall_m2": 16.0}},
        # 장롱/옷장: 문짝은 눕혀 붙여 빠르고(1품 14㎡), 몸통은 세워둔 채 좁은 틈에서
        # 작업해 훨씬 더디다(1품 7㎡). 한 덩어리로 묶으면 붙박이장 현장이 손해다.
        "wardrobe": {
            "primer_per_m2": 3_000,
            "hardware_per_door": 6_000,  # 손잡이/경첩 탈부착
            "manday_coverage": {"door_m2": 14.0, "body_m2": 7.0},
        },
        # 미세방충망: 원단은 ㎡당, 틀 신규 제작은 짝당. 창은 높이가 있어 사다리
        # 작업이 섞이므로 1품 처리량을 필름보다 낮게 잡는다.
        "mesh_screen": {
            "mesh_per_m2": {"fine_20": 12_000, "ultra_30": 18_000, "pet_proof": 28_000},
            "frame_per_screen": 15_000,
            "manday_coverage": {"screen_m2": 9.0},
        },
        # 변기: 대수 기준. 철거·폐기와 부속(급수호스·앙카)은 본체와 별개로 붙는다.
        "toilet": {
            "unit_price": {"standard": 180_000, "one_piece": 350_000, "bidet_combo": 700_000},
            "removal_per_unit": 30_000,
            "supply_line_per_unit": 25_000,
            "install_labor_per_unit": 80_000,
        },
        "sink": {
            "bowl_price": {"standard_850": 120_000, "standard_860": 130_000, "premium_square": 250_000},
            "faucet_price": {"none": 0, "waterfall": 90_000, "gooseneck": 130_000},
            "drain_price": {"stainless_basic": 25_000},
            "install_labor": 150_000,
        },
    },
}

# 앱의 단가 설정 화면에 뿌릴 목록. key는 위 구조를 점(.)으로 이은 경로다.
# 여기 없는 값은 화면에 나오지 않으므로, 현장에서 실제로 만지는 것만 골라 둔다.
PRICING_FIELDS: list[dict] = [
    {"key": "manday_rate", "label": "1품 인건비 (공임)", "group": "공임", "unit": "원"},
    {"key": "price_table.lighting.labor_per_unit", "label": "조명 설치비 (개당)", "group": "공임", "unit": "원"},
    {"key": "price_table.lighting.drilling_new_per_unit", "label": "신규 타공비 (개당)", "group": "공임", "unit": "원"},
    {"key": "price_table.lighting.wiring_per_m", "label": "배선 연장 (m당)", "group": "공임", "unit": "원"},
    {"key": "price_table.fan.labor_per_unit", "label": "실링팬 설치비 (대당)", "group": "공임", "unit": "원"},
    {"key": "price_table.fan.height_surcharge_per_m", "label": "천장 높이 할증 (m당)", "group": "공임", "unit": "원"},
    {"key": "price_table.sink.install_labor", "label": "싱크볼 설치비", "group": "공임", "unit": "원"},
    {"key": "price_table.glass.illust_per_unit", "label": "유리 일러스트 (건당)", "group": "공임", "unit": "원"},

    {"key": "price_table.film.primer_per_m2", "label": "필름 프라이머 (㎡당)", "group": "재료비", "unit": "원"},
    {"key": "price_table.sash.primer_per_m2", "label": "샷시 프라이머 (㎡당)", "group": "재료비", "unit": "원"},
    {"key": "price_table.glass.tint_material_per_m2.clear", "label": "썬팅 투명 (㎡당)", "group": "재료비", "unit": "원"},
    {"key": "price_table.glass.tint_material_per_m2.frosted", "label": "썬팅 반투명 (㎡당)", "group": "재료비", "unit": "원"},
    {"key": "price_table.glass.tint_material_per_m2.mirror", "label": "썬팅 미러 (㎡당)", "group": "재료비", "unit": "원"},
    {"key": "price_table.glass.tint_material_per_m2.blackout", "label": "썬팅 블랙아웃 (㎡당)", "group": "재료비", "unit": "원"},
    {"key": "price_table.lighting.unit_price_by_inch.3", "label": "다운라이트 3인치", "group": "재료비", "unit": "원"},
    {"key": "price_table.lighting.unit_price_by_inch.4", "label": "다운라이트 4인치", "group": "재료비", "unit": "원"},
    {"key": "price_table.lighting.unit_price_by_inch.5", "label": "다운라이트 5인치", "group": "재료비", "unit": "원"},
    {"key": "price_table.fan.unit_price", "label": "실링팬 본체", "group": "재료비", "unit": "원"},
    {"key": "price_table.sink.bowl_price.standard_850", "label": "싱크볼 스탠다드 850", "group": "재료비", "unit": "원"},
    {"key": "price_table.sink.bowl_price.standard_860", "label": "싱크볼 스탠다드 860", "group": "재료비", "unit": "원"},
    {"key": "price_table.sink.bowl_price.premium_square", "label": "싱크볼 프리미엄 사각", "group": "재료비", "unit": "원"},
    {"key": "price_table.sink.faucet_price.waterfall", "label": "수전 폭포형", "group": "재료비", "unit": "원"},
    {"key": "price_table.sink.faucet_price.gooseneck", "label": "수전 구스넥", "group": "재료비", "unit": "원"},
    {"key": "price_table.sink.drain_price.stainless_basic", "label": "배수구 스텐 기본", "group": "재료비", "unit": "원"},
    {"key": "price_table.fan.reinforcement_per_m2.gypsum", "label": "천장 보강 석고 (㎡당)", "group": "재료비", "unit": "원"},
    {"key": "price_table.fan.reinforcement_per_m2.concrete", "label": "천장 보강 콘크리트 (㎡당)", "group": "재료비", "unit": "원"},
    {"key": "price_table.fan.reinforcement_per_m2.wood_reinforced", "label": "천장 보강 목공 (㎡당)", "group": "재료비", "unit": "원"},

    {"key": "price_table.door_difficulty_multiplier.lattice", "label": "알판/격자문 인건비 할증 배수", "group": "품 산출", "unit": "배"},
    {"key": "price_table.door_difficulty_multiplier.glass", "label": "타공문(유리) 인건비 할증 배수", "group": "품 산출", "unit": "배"},

    {"key": "loss_rate_percent", "label": "자재 로스율", "group": "요율", "unit": "%"},
    {"key": "vat_rate_percent", "label": "부가세율", "group": "요율", "unit": "%"},

    {"key": "price_table.film.manday_coverage.upper_cabinet_m2", "label": "상부장 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.film.manday_coverage.lower_cabinet_m2", "label": "하부장 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.film.manday_coverage.island_table_m2", "label": "아일랜드 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.wall_film.primer_per_m2", "label": "벽면 프라이머(면처리)", "group": "재료비", "unit": "원/㎡"},
    {"key": "price_table.wall_film.manday_coverage.wall_m2", "label": "벽면 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.wardrobe.primer_per_m2", "label": "장롱/옷장 프라이머", "group": "재료비", "unit": "원/㎡"},
    {"key": "price_table.wardrobe.hardware_per_door", "label": "옷장 손잡이·경첩 탈부착", "group": "재료비", "unit": "원/짝"},
    {"key": "price_table.wardrobe.manday_coverage.door_m2", "label": "옷장 문짝 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.wardrobe.manday_coverage.body_m2", "label": "옷장 몸통 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.mesh_screen.mesh_per_m2.fine_20", "label": "미세방충망 원단(20메시)", "group": "재료비", "unit": "원/㎡"},
    {"key": "price_table.mesh_screen.mesh_per_m2.ultra_30", "label": "초미세방충망 원단(30메시)", "group": "재료비", "unit": "원/㎡"},
    {"key": "price_table.mesh_screen.mesh_per_m2.pet_proof", "label": "펫 방충망 원단", "group": "재료비", "unit": "원/㎡"},
    {"key": "price_table.mesh_screen.frame_per_screen", "label": "방충망 틀 신규 제작", "group": "재료비", "unit": "원/짝"},
    {"key": "price_table.mesh_screen.manday_coverage.screen_m2", "label": "방충망 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.toilet.unit_price.standard", "label": "일반형 변기", "group": "재료비", "unit": "원/대"},
    {"key": "price_table.toilet.unit_price.one_piece", "label": "원피스 변기", "group": "재료비", "unit": "원/대"},
    {"key": "price_table.toilet.unit_price.bidet_combo", "label": "비데 일체형 변기", "group": "재료비", "unit": "원/대"},
    {"key": "price_table.toilet.removal_per_unit", "label": "기존 변기 철거·폐기", "group": "재료비", "unit": "원/대"},
    {"key": "price_table.toilet.supply_line_per_unit", "label": "급수호스·앙카 부속", "group": "재료비", "unit": "원/대"},
    {"key": "price_table.toilet.install_labor_per_unit", "label": "변기 설치 공임", "group": "공임", "unit": "원/대"},
    {"key": "price_table.door_frame.primer_per_m2", "label": "문짝/문틀 프라이머", "group": "재료비", "unit": "원/㎡"},
    {"key": "price_table.door_frame.hardware_per_door", "label": "문짝 손잡이·경첩 탈부착", "group": "재료비", "unit": "원/짝"},
    {"key": "price_table.door_frame.manday_coverage.door_m2", "label": "문짝 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.door_frame.manday_coverage.doorframe_m2", "label": "문틀 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.film.manday_coverage.door_m2", "label": "방문 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.film.manday_coverage.doorframe_m2", "label": "문틀 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.film.manday_coverage.tall_cabinet_m2", "label": "장(키큰장) 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.film.manday_coverage.molding_m", "label": "몰딩 1품 처리량", "group": "품 산출", "unit": "m"},
    {"key": "price_table.sash.manday_coverage.sash_m2", "label": "샷시 1품 처리량", "group": "품 산출", "unit": "㎡"},
    {"key": "price_table.glass.tint_manday_m2", "label": "썬팅 1품 처리량", "group": "품 산출", "unit": "㎡"},
]


def _load_overrides() -> dict:
    if not os.path.exists(PRICING_PATH):
        return {}
    try:
        with open(PRICING_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        # 파일이 깨졌다고 견적을 못 내면 안 된다 — 기준값으로 조용히 돌아간다.
        return {}


def _dig(target: dict, key: str):
    node = target
    parts = key.split(".")
    for part in parts[:-1]:
        if not isinstance(node, dict) or part not in node:
            return None, None
        node = node[part]
    return (node, parts[-1]) if isinstance(node, dict) and parts[-1] in node else (None, None)


def effective() -> dict:
    """기준값 위에 사장님이 조정한 값을 얹은 최종 단가."""
    pricing = copy.deepcopy(DEFAULT_PRICING)
    for key, value in _load_overrides().items():
        node, leaf = _dig(pricing, key)
        if node is None:
            continue  # 예전 버전에서 쓰던 항목이면 무시한다
        # 정수로 관리하던 값(원 단위)은 정수로 되돌려 견적서에 소수점이 안 뜨게 한다.
        node[leaf] = int(value) if isinstance(node[leaf], int) else float(value)
    return pricing


def list_fields() -> list[dict]:
    """설정 화면에 뿌릴 항목 목록 — 현재값과 기본값을 함께 준다."""
    current = effective()
    fields = []
    for spec in PRICING_FIELDS:
        node, leaf = _dig(current, spec["key"])
        base_node, base_leaf = _dig(DEFAULT_PRICING, spec["key"])
        if node is None or base_node is None:
            continue
        fields.append({**spec, "value": node[leaf], "default": base_node[base_leaf]})
    return fields


def save_overrides(values: dict) -> list[dict]:
    """조정한 값을 저장한다. 기본값과 같아진 항목은 덮어쓰기 목록에서 빼서,
    나중에 기준값이 바뀌면 자연스럽게 따라가게 한다."""
    known = {spec["key"] for spec in PRICING_FIELDS}
    overrides = _load_overrides()

    for key, value in values.items():
        if key not in known:
            continue
        base_node, base_leaf = _dig(DEFAULT_PRICING, key)
        if base_node is None:
            continue
        default_value = base_node[base_leaf]
        number = int(value) if isinstance(default_value, int) else float(value)
        if number == default_value:
            overrides.pop(key, None)
        else:
            overrides[key] = number

    os.makedirs(os.path.dirname(PRICING_PATH), exist_ok=True)
    with open(PRICING_PATH, "w", encoding="utf-8") as f:
        json.dump(overrides, f, ensure_ascii=False, indent=2)
    return list_fields()
