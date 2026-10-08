"""시공 항목별(필름/조명/실링팬/싱크볼) 정밀 견적 라인아이템 계산.

[인테리어 필름] 자재비는 반드시 아래 순서로 계산한다 — 필름은 폭(장폭) 1.22m로
고정된 원단을 "길이(m)" 단위로 사서 필요한 만큼 재단해 쓰는 자재이기 때문에,
낱개 부위 면적에 ㎡당 단가를 바로 곱하면(장폭을 무시하면) 실제 소요 원단량과
단가가 어긋난다.
  A. 부위별 총 면적(㎡) = Σ ((가로mm × 세로mm ÷ 1,000,000) × 개수)
     — 걸레받이/몰딩처럼 길이(m)로만 입력받는 항목은 표준 폭 0.15m를 곱해
       면적으로 환산한 뒤 같은 합계에 더한다 (얇은 몰딩 여러 줄을 원단 폭
       1.22m 안에 나란히 재단하는 실제 재단 방식과 동일한 효과).
  B. 로스율 반영 면적 = 총 면적(㎡) × 1.15 (로스율 15%)
  C. 필요 원단 길이(m) = 로스율 반영 면적 ÷ 1.22 (표준 장폭)
  D. 최종 자재비 = 올림(필요 원단 길이, 소수점 1자리) × 원/m 단가
모든 부위를 하나의 원단 소요량으로 합산해 "필름 원단" 한 줄로 청구하고
(실제로 한 롤에서 여러 부위를 함께 재단하므로 부위별로 따로 올림하지 않는다),
인건비(품)만 부위별 난이도에 맞춰 개별 산출한다.

그 외 항목(조명/실링팬/싱크볼)은 [spec] × [quantity] × [unit_price] = [amount]
구조의 행(row)으로 산출하고, 프론트엔드가 '자재 내역/인건비/부자재·경비' 3개
섹션으로 다시 묶어 회계 장부처럼 보여줄 수 있도록 각 행에 category를 붙인다.
"""
import math

from app.catalog import (
    DRAIN_TYPES,
    FAUCET_TYPES,
    GLASS_TINT_TYPES,
    MESH_TYPES,
    PATTERNS,
    SINK_BOWL_SPECS,
    TOILET_SPECS,
    WORK_ITEMS,
)
from app import pricing_store
from app.schemas import (
    DoorFrameOptions,
    MeshScreenOptions,
    WallFilmOptions,
    WardrobeOptions,
    ToiletOptions,
    FanOptions,
    FilmOptions,
    GlassOptions,
    IllustrationOptions,
    JobOptions,
    LightingOptions,
    PanelItem,
    SashOptions,
    SinkOptions,
)

FILM_ROLL_WIDTH_M = 1.22  # 인테리어 필름 표준 장폭
DOOR_SIDES = 2  # 방문(문짝)은 앞면·뒷면 모두 시공 — 입력 치수는 한 면 기준
MOLDING_WIDTH_M = 0.15  # 걸레받이/몰딩 표준 폭 (길이 입력을 면적으로 환산할 때 사용)


# 단가(공임/재료비/요율)는 앱의 단가 설정에서 바꿀 수 있으므로 모듈 상수로 굳히지
# 않고 계산할 때마다 읽는다 — 상수로 두면 서버를 다시 띄우기 전까지 바뀐 단가가
# 견적에 반영되지 않는다. 기준값과 저장 위치는 app/pricing_store.py 참고.
def _pricing() -> dict:
    return pricing_store.effective()


def _manday_rate() -> int:
    return _pricing()["manday_rate"]


def _loss_rate() -> float:
    return 1 + _pricing()["loss_rate_percent"] / 100


def _vat_rate() -> float:
    return _pricing()["vat_rate_percent"] / 100


def _prices() -> dict:
    return _pricing()["price_table"]


def _detail(
    label: str,
    quantity: float,
    unit: str,
    unit_price: int,
    category: str,
    spec: str = "",
    material_code: str = "",
) -> dict:
    return {
        "label": label,
        "spec": spec,
        "quantity": quantity,
        "unit": unit,
        "unit_price": unit_price,
        "amount": round(quantity * unit_price),
        "category": category,
        "material_code": material_code,
    }


def _manday_detail(label: str, workload: float, coverage: float, spec: str = "") -> dict:
    man_days = round(workload / coverage, 2) if coverage > 0 else 0.0
    return _detail(label, man_days, "품", _manday_rate(), "labor", spec)


def _panel_area_m2(item: PanelItem) -> float:
    # (가로mm × 세로mm ÷ 1,000,000) × 개수 = 이 항목의 총 면적(㎡)
    return (item.width_mm * item.height_mm / 1_000_000) * item.count


def _panels_area_m2(items: list[PanelItem]) -> float:
    return sum(_panel_area_m2(i) for i in items if i.count > 0)


def _panels_spec_text(items: list[PanelItem]) -> str:
    active = [i for i in items if i.count > 0]
    return ", ".join(f"{i.width_mm}×{i.height_mm}mm×{i.count}" for i in active)


DOOR_TYPE_LABELS = {"lattice": "알판/격자문", "glass": "타공문(유리)"}


def _door_labor_multiplier(door_type: str) -> float:
    if door_type == "flat" or door_type not in DOOR_TYPE_LABELS:
        return 1.0
    return _prices().get("door_difficulty_multiplier", {}).get(door_type, 1.0)


def _panels_labor_area_m2(items: list[PanelItem]) -> float:
    """문짝류 인건비(품) 산출 전용 '가중 면적' — 알판/격자문·타공문은 세로 기둥·
    가로대·알판(또는 프레임)으로 나눠 겹쳐 붙이는 덧방 시공이라 통판(민짜문)보다
    훨씬 오래 걸린다. 그 난이도를 면적에 곱해 품을 더 많이 잡는다. 원단 소요량
    (자재비)은 이 가중치를 적용하지 않은 실측 면적 그대로 쓴다 — 필름 원단은
    실제로 잘라 쓰는 물리적 넓이만큼만 소모되지, 시공 난이도와는 무관하다."""
    return sum(_panel_area_m2(i) * _door_labor_multiplier(i.door_type) for i in items if i.count > 0)


def _door_types_spec_suffix(items: list[PanelItem]) -> str:
    """알판/격자·타공 문짝이 섞여 있으면 몇 짝에 어떤 할증이 붙었는지 견적서
    상세 spec에 덧붙인다 — 인건비가 왜 더 나왔는지 고객·사장님 모두 바로 읽힌다."""
    counts: dict[str, int] = {}
    for i in items:
        if i.count > 0 and i.door_type in DOOR_TYPE_LABELS:
            counts[i.door_type] = counts.get(i.door_type, 0) + i.count
    if not counts:
        return ""
    parts = [
        f"{DOOR_TYPE_LABELS[t]} {n}짝(할증 {_door_labor_multiplier(t)}배)" for t, n in counts.items()
    ]
    return " · " + " + ".join(parts)


def _line_item(item_id: str, details: list[dict]) -> dict:
    details = [d for d in details if d["quantity"] > 0]
    return {
        "item_id": item_id,
        "item_name": WORK_ITEMS[item_id]["name"],
        "details": details,
        "subtotal": sum(d["amount"] for d in details),
    }


def _film_line_item(opts: FilmOptions) -> dict:
    table = _prices()["film"]
    coverage = table["manday_coverage"]
    details = []

    # 인건비 산출 대상: (표시 라벨, 품 산출 기준 카테고리 키, 항목 배열)
    panel_categories: list[tuple[str, str, list[PanelItem]]] = [
        ("상부장", "upper_cabinet_m2", opts.upper_cabinets),
        ("하부장", "lower_cabinet_m2", opts.lower_cabinets),
        ("아일랜드 식탁", "island_table_m2", opts.island_tables),
        ("방문", "door_m2", opts.doors),
        ("문틀", "doorframe_m2", opts.doorframes),
        ("냉장고장", "tall_cabinet_m2", opts.fridge_cabinets),
        ("펜트리장", "tall_cabinet_m2", opts.pantry_cabinets),
        ("신발장", "tall_cabinet_m2", opts.shoe_cabinets),
    ]

    # A. 부위별 총 면적(㎡) 합산 — 걸레받이/몰딩은 표준 폭(0.15m)을 곱해 면적으로 환산해 더한다.
    total_area_m2 = 0.0
    for _, _, items in panel_categories:
        total_area_m2 += _panels_area_m2(items)
    molding_area_m2 = opts.molding_length_m * MOLDING_WIDTH_M
    total_area_m2 += molding_area_m2

    if total_area_m2 <= 0:
        return _line_item("film", [])

    # B. 로스율 반영 → C. 필요 원단 길이(m) → D. 소수점 1자리 올림 후 원/m 단가 적용
    lossed_area_m2 = total_area_m2 * _loss_rate()
    required_length_m = lossed_area_m2 / FILM_ROLL_WIDTH_M
    billed_length_m = math.ceil(required_length_m * 10) / 10
    material_amount = round(billed_length_m * opts.unit_price_per_m)

    details = [
        _detail(
            "필름 원단",
            billed_length_m,
            "m",
            opts.unit_price_per_m,
            "material",
            f"총 시공 면적 {round(total_area_m2, 2)}㎡ (로스율 15% · 장폭 {FILM_ROLL_WIDTH_M}m 반영)",
            material_code=opts.pattern_id,
        )
    ]

    # 부자재/인건비는 부위별 실제 작업 물량 기준으로 개별 산출한다.
    for label, coverage_key, items in panel_categories:
        area = _panels_area_m2(items)
        if area <= 0:
            continue
        spec = _panels_spec_text(items)
        if opts.needs_primer:
            details.append(_detail(f"{label} 프라이머 도포비", area, "㎡", table["primer_per_m2"], "expense", spec))
        # "방문"(door_m2)만 알판/격자·타공 난이도 할증이 있는 문짝류라, 인건비만
        # 가중 면적으로 따로 산출한다(자재비는 위에서 이미 실측 면적으로 계산 끝).
        labor_area = _panels_labor_area_m2(items) if coverage_key == "door_m2" else area
        labor_spec = spec + _door_types_spec_suffix(items) if coverage_key == "door_m2" else spec
        details.append(_manday_detail(f"{label} 시공 인건비", labor_area, coverage[coverage_key], labor_spec))

    if opts.molding_length_m > 0:
        details.append(
            _manday_detail(
                "걸레받이/몰딩 시공 인건비", opts.molding_length_m, coverage["molding_m"], f"총 길이 {opts.molding_length_m}m"
            )
        )

    return _line_item("film", details)


def _sash_line_item(opts: SashOptions) -> dict:
    """샷시(창틀) 필름. 자재는 필름과 같은 장폭 원단 계산식(면적→로스율→÷1.22→올림)을
    쓰고, 인건비만 창틀 기준 품으로 따로 산출한다."""
    table = _prices()["sash"]
    area_m2 = _panels_area_m2(opts.frames)
    if area_m2 <= 0:
        return _line_item("sash", [])

    lossed_area_m2 = area_m2 * _loss_rate()
    billed_length_m = math.ceil((lossed_area_m2 / FILM_ROLL_WIDTH_M) * 10) / 10
    spec = _panels_spec_text(opts.frames)

    details = [
        _detail(
            "샷시 필름 원단",
            billed_length_m,
            "m",
            opts.unit_price_per_m,
            "material",
            f"창틀 면적 {round(area_m2, 2)}㎡ (로스율 15% · 장폭 {FILM_ROLL_WIDTH_M}m 반영)",
            material_code=opts.pattern_id,
        )
    ]
    if opts.needs_primer:
        details.append(_detail("샷시 프라이머 도포비", area_m2, "㎡", table["primer_per_m2"], "expense", spec))
    details.append(_manday_detail("샷시 시공 인건비", area_m2, table["manday_coverage"]["sash_m2"], spec))

    return _line_item("sash", details)


def _door_frame_line_item(opts: DoorFrameOptions) -> dict:
    """문짝/문틀 시공. 원단 계산식은 필름과 같지만(면적→로스율→÷장폭→올림),
    품은 문짝과 문틀을 따로 센다 — 문짝은 평평해 빨리 붙고 문틀은 모서리가 많아
    같은 면적이라도 훨씬 오래 걸린다. 한 덩어리로 묶으면 문틀 많은 현장이 손해다."""
    table = _prices()["door_frame"]
    coverage = table["manday_coverage"]
    # 방문은 입체물이라 앞면·뒷면을 다 시공한다. 입력은 "한 면" 치수이므로 2면으로 곱한다.
    # 문틀은 펼쳐서 잰 감는 폭이 이미 앞뒤를 포함하므로 곱하지 않는다.
    door_area = _panels_area_m2(opts.doors) * DOOR_SIDES
    frame_area = _panels_area_m2(opts.doorframes)
    total_area = door_area + frame_area
    if total_area <= 0:
        return _line_item("door_frame", [])

    lossed_area_m2 = total_area * _loss_rate()
    billed_length_m = math.ceil((lossed_area_m2 / FILM_ROLL_WIDTH_M) * 10) / 10
    details = [
        _detail(
            "문짝/문틀 필름 원단",
            billed_length_m,
            "m",
            opts.unit_price_per_m,
            "material",
            f"문짝 {round(door_area, 2)}㎡(앞·뒤 2면) + 문틀 {round(frame_area, 2)}㎡ "
            f"(로스율 15% · 장폭 {FILM_ROLL_WIDTH_M}m 반영)",
            material_code=opts.pattern_id,
        )
    ]

    door_count = sum(p.count for p in opts.doors)
    if door_count > 0:
        details.append(
            _detail(
                "손잡이·경첩 탈부착",
                door_count,
                "짝",
                table["hardware_per_door"],
                "expense",
                f"문짝 {door_count}짝",
            )
        )
    if opts.needs_primer:
        details.append(
            _detail("문짝/문틀 프라이머 도포비", total_area, "㎡", table["primer_per_m2"], "expense")
        )

    if door_area > 0:
        details.append(
            _manday_detail(
                "문짝 시공 인건비",
                _panels_labor_area_m2(opts.doors) * DOOR_SIDES,
                coverage["door_m2"],
                _panels_spec_text(opts.doors) + " · 앞뒤 2면" + _door_types_spec_suffix(opts.doors),
            )
        )
    if frame_area > 0:
        details.append(
            _manday_detail(
                "문틀 시공 인건비", frame_area, coverage["doorframe_m2"], _panels_spec_text(opts.doorframes)
            )
        )

    return _line_item("door_frame", details)


def _wall_film_line_item(opts: WallFilmOptions) -> dict:
    """벽면 시트지. 원단 계산은 필름과 같고 품만 벽 기준으로 따로 센다."""
    table = _prices()["wall_film"]
    area = _panels_area_m2(opts.walls)
    if area <= 0:
        return _line_item("wall_film", [])
    billed = math.ceil((area * _loss_rate() / FILM_ROLL_WIDTH_M) * 10) / 10
    spec = _panels_spec_text(opts.walls)
    details = [
        _detail("벽면 시트지 원단", billed, "m", opts.unit_price_per_m, "material",
                f"벽 면적 {round(area, 2)}㎡ (로스율 15% · 장폭 {FILM_ROLL_WIDTH_M}m 반영)",
                material_code=opts.pattern_id)
    ]
    if opts.needs_primer:
        details.append(_detail("벽면 면처리(프라이머)", area, "㎡", table["primer_per_m2"], "expense", spec))
    details.append(_manday_detail("벽면 시공 인건비", area, table["manday_coverage"]["wall_m2"], spec))
    return _line_item("wall_film", details)


def _wardrobe_line_item(opts: WardrobeOptions) -> dict:
    """장롱/옷장 필름. 원단 계산은 필름과 같고, 품만 문짝/몸통으로 갈라 센다."""
    table = _prices()["wardrobe"]
    coverage = table["manday_coverage"]
    door_area = _panels_area_m2(opts.doors)
    body_area = _panels_area_m2(opts.bodies)
    total_area = door_area + body_area
    if total_area <= 0:
        return _line_item("wardrobe", [])

    billed_length_m = math.ceil((total_area * _loss_rate() / FILM_ROLL_WIDTH_M) * 10) / 10
    details = [
        _detail(
            "장롱/옷장 필름 원단",
            billed_length_m,
            "m",
            opts.unit_price_per_m,
            "material",
            f"문짝 {round(door_area, 2)}㎡ + 몸통 {round(body_area, 2)}㎡ "
            f"(로스율 15% · 장폭 {FILM_ROLL_WIDTH_M}m 반영)",
            material_code=opts.pattern_id,
        )
    ]
    door_count = sum(p.count for p in opts.doors)
    if door_count > 0:
        details.append(
            _detail("손잡이·경첩 탈부착", door_count, "짝", table["hardware_per_door"], "expense")
        )
    if opts.needs_primer:
        details.append(
            _detail("장롱/옷장 프라이머 도포비", total_area, "㎡", table["primer_per_m2"], "expense")
        )
    if door_area > 0:
        details.append(
            _manday_detail(
                "옷장 문짝 시공 인건비",
                _panels_labor_area_m2(opts.doors),
                coverage["door_m2"],
                _panels_spec_text(opts.doors) + _door_types_spec_suffix(opts.doors),
            )
        )
    if body_area > 0:
        details.append(
            _manday_detail("옷장 몸통 시공 인건비", body_area, coverage["body_m2"], _panels_spec_text(opts.bodies))
        )
    return _line_item("wardrobe", details)


def _mesh_screen_line_item(opts: MeshScreenOptions) -> dict:
    """미세방충망 교체. 원단은 창 면적(㎡) 기준, 틀 신규 제작은 짝당으로 붙는다."""
    table = _prices()["mesh_screen"]
    area_m2 = _panels_area_m2(opts.screens)
    if area_m2 <= 0:
        return _line_item("mesh_screen", [])

    screen_count = sum(p.count for p in opts.screens)
    mesh_price = table["mesh_per_m2"][opts.mesh_type]
    spec = _panels_spec_text(opts.screens)
    # 원단은 재단 로스가 생기므로 다른 시공과 같은 로스율을 적용한다.
    billed_area = round(area_m2 * _loss_rate(), 2)

    details = [
        _detail(
            MESH_TYPES[opts.mesh_type]["name"],
            billed_area,
            "㎡",
            mesh_price,
            "material",
            f"창 {screen_count}짝 · {round(area_m2, 2)}㎡ (로스율 반영)",
        )
    ]
    if opts.replace_frame:
        details.append(
            _detail("방충망 틀 신규 제작", screen_count, "짝", table["frame_per_screen"], "material", spec)
        )
    details.append(
        _manday_detail("방충망 교체 인건비", area_m2, table["manday_coverage"]["screen_m2"], spec)
    )
    return _line_item("mesh_screen", details)


def _toilet_line_item(opts: ToiletOptions) -> dict:
    """변기 설치/교체. 대수 기준이라 면적 계산이 없다."""
    table = _prices()["toilet"]
    count = max(0, opts.count)
    if count <= 0:
        return _line_item("toilet", [])

    details = [
        _detail(
            TOILET_SPECS[opts.spec]["name"],
            count,
            "대",
            table["unit_price"][opts.spec],
            "material",
        )
    ]
    if opts.remove_existing:
        details.append(
            _detail("기존 변기 철거·폐기", count, "대", table["removal_per_unit"], "expense")
        )
    if opts.replace_supply_line:
        details.append(
            _detail("급수호스·앙카 부속", count, "대", table["supply_line_per_unit"], "expense")
        )
    details.append(
        _detail("변기 설치 공임", count, "대", table["install_labor_per_unit"], "labor")
    )
    return _line_item("toilet", details)


def _glass_line_item(opts: GlassOptions) -> dict:
    """유리 썬팅(면적 기준) + 일러스트 컷팅 그래픽(건당 기준)."""
    table = _prices()["glass"]
    details = []
    area_m2 = _panels_area_m2(opts.panels)

    if opts.work_type == "tint" and area_m2 > 0:
        unit_price = table["tint_material_per_m2"][opts.tint_type]
        spec = f"{GLASS_TINT_TYPES[opts.tint_type]['name']} · {_panels_spec_text(opts.panels)}"
        details.append(_detail("썬팅 필름 자재비", area_m2, "㎡", unit_price, "material", spec))
        details.append(_manday_detail("썬팅 시공 인건비", area_m2, table["tint_manday_m2"]))

    return _line_item("glass", details)


def _illustration_line_item(opts: IllustrationOptions) -> dict:
    """사장님 전용 일러스트 항목. 단가는 예전 유리 일러스트와 같은 표(glass.illust_per_unit)를 쓴다."""
    table = _prices()["glass"]
    details = []
    if opts.count > 0:
        details.append(_detail("일러스트 그래픽 제작·시공", opts.count, "건", table["illust_per_unit"], "material"))
    return _line_item("illustration", details)


def _lighting_line_item(opts: LightingOptions) -> dict:
    table = _prices()["lighting"]
    details = []

    if opts.light_count > 0:
        unit_price = table["unit_price_by_inch"][opts.inch]
        details.append(_detail(f"다운라이트 ({opts.inch}인치) 자재비", opts.light_count, "개", unit_price, "material", f"{opts.inch}인치"))
        details.append(_detail("다운라이트 설치 인건비", opts.light_count, "개", table["labor_per_unit"], "labor"))

        # 다운라이트는 예외 없이 천장을 새로 타공해야 하므로 항상 타공비를 넣는다.
        details.append(_detail("천장 타공", opts.light_count, "개", table["drilling_new_per_unit"], "expense"))

    if opts.wiring_extension_m > 0:
        details.append(_detail("배선 연장", opts.wiring_extension_m, "m", table["wiring_per_m"], "expense"))

    return _line_item("lighting", details)


def _fan_line_item(opts: FanOptions) -> dict:
    table = _prices()["fan"]
    details = []

    if opts.fan_count > 0:
        details.append(_detail("실링팬 본체 자재비", opts.fan_count, "대", table["unit_price"], "material"))
        details.append(_detail("실링팬 설치 인건비", opts.fan_count, "대", table["labor_per_unit"], "labor"))

        height_extra_m = max(0.0, opts.ceiling_height_m - table["height_base_m"])
        if height_extra_m > 0:
            surcharge_per_unit = round(height_extra_m * table["height_surcharge_per_m"])
            details.append(
                _detail("고소 작업 할증", opts.fan_count, "대", surcharge_per_unit, "expense", f"층고 {opts.ceiling_height_m}m")
            )

    if opts.reinforcement_area_m2 > 0:
        from app.catalog import CEILING_REINFORCEMENT_TYPES

        material_name = CEILING_REINFORCEMENT_TYPES[opts.ceiling_material]["name"]
        details.append(
            _detail(
                f"천장 보강 ({material_name})",
                opts.reinforcement_area_m2,
                "㎡",
                table["reinforcement_per_m2"][opts.ceiling_material],
                "expense",
            )
        )

    return _line_item("fan", details)


def _sink_line_item(opts: SinkOptions) -> dict:
    table = _prices()["sink"]
    details = [_detail(SINK_BOWL_SPECS[opts.spec]["name"], 1, "개", table["bowl_price"][opts.spec], "material", "싱크볼 타공 규격")]
    if opts.faucet_type != "none":
        details.append(_detail(FAUCET_TYPES[opts.faucet_type]["name"], 1, "개", table["faucet_price"][opts.faucet_type], "material"))
    details.append(_detail(DRAIN_TYPES[opts.drain_type]["name"], 1, "세트", table["drain_price"][opts.drain_type], "expense"))
    details.append(_detail("설치 공임", 1, "식", table["install_labor"], "labor"))

    return _line_item("sink", details)


def _material_orders(line_items: list[dict]) -> list[dict]:
    """품번(패턴 id)별 자재 발주 집계 — 일본 クロス職人(크로스 기공) 업계 앱(採寸くん 등)의
    "품번별로 모아 한 번에 발주" 방식을 그대로 따른다. 사장님이 싱크대 필름과 문짝을
    같은 색으로 고르면 발주도 한 번에 해야 하므로, 항목(item)이 달라도 pattern_id가
    같으면 한 줄로 합친다. 자재가 아닌 행(인건비·경비)과 material_code가 없는 행
    (조명·싱크볼 등 품번 개념이 없는 항목)은 집계에서 뺀다."""
    by_code: dict[str, dict] = {}
    for item in line_items:
        for d in item["details"]:
            code = d.get("material_code") or ""
            if not code or d["category"] != "material":
                continue
            bucket = by_code.setdefault(code, {"total_length_m": 0.0, "item_names": []})
            bucket["total_length_m"] += d["quantity"]
            if item["item_name"] not in bucket["item_names"]:
                bucket["item_names"].append(item["item_name"])

    orders = []
    for code, bucket in by_code.items():
        pattern = PATTERNS.get(code, {})
        orders.append(
            {
                "pattern_id": code,
                "name": pattern.get("name", code),
                "color_hex": pattern.get("color_hex", ""),
                "total_length_m": round(bucket["total_length_m"], 1),
                # 발주는 소수점 단위로 끊어 사지 않으므로 정수 미터로 올려 보여준다.
                "order_length_m": math.ceil(bucket["total_length_m"]),
                "item_names": bucket["item_names"],
            }
        )
    orders.sort(key=lambda o: o["total_length_m"], reverse=True)
    return orders


def calculate_estimate(
    selected_items: list[str],
    options: JobOptions,
    ceiling_area_m2: float,
) -> dict:
    line_items = []

    if "film" in selected_items and options.film:
        line_items.append(_film_line_item(options.film))
    if "sash" in selected_items and options.sash:
        line_items.append(_sash_line_item(options.sash))
    if "glass" in selected_items and options.glass:
        line_items.append(_glass_line_item(options.glass))
    if "lighting" in selected_items and options.lighting:
        line_items.append(_lighting_line_item(options.lighting))
    if "fan" in selected_items and options.fan:
        line_items.append(_fan_line_item(options.fan))
    if "wall_film" in selected_items and options.wall_film:
        line_items.append(_wall_film_line_item(options.wall_film))
    if "wardrobe" in selected_items and options.wardrobe:
        line_items.append(_wardrobe_line_item(options.wardrobe))
    if "mesh_screen" in selected_items and options.mesh_screen:
        line_items.append(_mesh_screen_line_item(options.mesh_screen))
    if "toilet" in selected_items and options.toilet:
        line_items.append(_toilet_line_item(options.toilet))
    if "door_frame" in selected_items and options.door_frame:
        line_items.append(_door_frame_line_item(options.door_frame))
    if "sink" in selected_items and options.sink:
        line_items.append(_sink_line_item(options.sink))
    if "illustration" in selected_items and options.illustration:
        line_items.append(_illustration_line_item(options.illustration))

    line_items = [item for item in line_items if item["details"]]

    all_details = [d for item in line_items for d in item["details"]]
    material_total = sum(d["amount"] for d in all_details if d["category"] == "material")
    labor_total = sum(d["amount"] for d in all_details if d["category"] == "labor")
    expense_total = sum(d["amount"] for d in all_details if d["category"] == "expense")

    supply_amount = material_total + labor_total + expense_total
    vat = round(supply_amount * _vat_rate())
    total_cost = supply_amount + vat

    return {
        "line_items": line_items,
        "ceiling_area_m2": round(ceiling_area_m2, 2),
        "material_total": material_total,
        "labor_total": labor_total,
        "expense_total": expense_total,
        "supply_amount": supply_amount,
        "vat": vat,
        "total_cost": total_cost,
        "material_orders": _material_orders(line_items),
    }
