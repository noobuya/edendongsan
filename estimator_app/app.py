"""대한인테리어필름 인테리어 필름 - 가치 기반(Value-Based) 프리미엄 견적 앱 백엔드.

고객 화면에는 '완성된 패키지의 가치'만 노출하고(자재비/시공비 분리 노출 없음),
사장님은 총액을 더블탭/롱프레스하면 열리는 스텔스 패널에서만 원가 구조를 확인한다.

[원자재값·공임비를 화면에서 바로 고칠 수 있는 이유]
현장 자재 시세와 인건비는 지역·시기·거래처에 따라 계속 달라지므로, 코드를 고쳐 다시
배포하지 않고도 사장님이 직접 조정할 수 있어야 한다. 아래 DEFAULT_ITEMS의 값은
"기본값"일 뿐이고, storage/pricing_overrides.json에 저장된 값이 있으면 그것을 우선한다
(메인 백엔드 app/pricing_store.py와 같은 방식). /api/pricing으로 읽고 쓴다.
"""
import json
import os

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.json.sort_keys = False  # 품목 카드는 위 정의 순서(필름 → 조명 → 설비)대로 노출

_STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
_PRICING_PATH = os.path.join(_STORAGE_DIR, "pricing_overrides.json")

# ------------------------------------------------------------------
# 1. 품목별 기본 단가 사전
#    - label: 고객에게 노출되는 완성형 패키지명 ("~리폼 세트")
#    - design_type: 시공 난이도를 대체하는 고객 친화적 '디자인 타입' 워딩
#                    (해당 없는 품목은 None)
#    - film_meters: 사장님 전용 원가 분석용 예상 원단 소요량(미터/개당)
#    - material_cost / labor_cost: 원자재값·공임비를 따로 잡는다. 고객에게 보이는
#      패키지 금액(price)은 이 둘을 더한 값으로 항상 자동 계산된다 — 화면에는
#      합계만 노출하고, 이 두 숫자는 단가 설정(사장님 전용)에서만 만진다.
# ------------------------------------------------------------------
DEFAULT_ITEMS = {
    # 민자/알판 두 SKU를 하나로 합쳤다 — "민자/알판·무늬" 토글(design_type_surcharge)과
    # 문 크기(가로×세로)에 따라 할증이 자동으로 더해지는 동적 단가다(_door_set_pricing 참고).
    # material_cost/labor_cost는 "민자" 기준 기본값이고, 할증은 계산 시점에 따로 더한다.
    "DOOR_SET": {
        "group": "필름 시공",
        "label": "도어 리폼 세트", "icon": "🚪",
        "chip": ["#60a5fa", "#3b82f6"], "design_type": None, "film_meters": 4.0,
        "material_cost": 40000, "labor_cost": 160000,
        "replacement_cost_reference": 500000,  # 문짝 전체 교체 시 평균 비용(영업 멘트 기준값)
    },
    "SASH_SMALL": {
        "group": "필름 시공",
        "label": "방창 리폼 세트", "icon": "🪟",
        "chip": ["#34d399", "#10b981"], "design_type": None, "film_meters": 3.0,
        "material_cost": 30000, "labor_cost": 120000,
        "replacement_cost_reference": 300000,
    },
    "SASH_LARGE": {
        "group": "필름 시공",
        "label": "거실 대창 리폼 세트", "icon": "🪟",
        "chip": ["#22d3ee", "#06b6d4"], "design_type": None, "film_meters": 5.0,
        "material_cost": 36000, "labor_cost": 144000,
        "replacement_cost_reference": 400000,
    },
    "SINK_L": {
        "group": "필름 시공",
        "label": "ㄱ자 싱크대 리폼 세트", "icon": "🍳",
        "chip": ["#fb923c", "#f97316"], "design_type": None, "film_meters": 11.0,
        "material_cost": 120000, "labor_cost": 480000,
    },
    "MOLDING_FLAT": {
        "group": "필름 시공",
        "label": "평몰딩 라인 세트", "icon": "📏",
        "chip": ["#a78bfa", "#8b5cf6"], "design_type": "민자/평판 타입", "film_meters": 18.0,
        "material_cost": 120000, "labor_cost": 480000,
        "replacement_cost_reference": 400000,
    },
    "MOLDING_CROWN": {
        "group": "필름 시공",
        "label": "장식 몰딩 라인 세트", "icon": "📐",
        "chip": ["#c084fc", "#a855f7"], "design_type": "웨인스코팅/알판/굴곡 타입", "film_meters": 22.0,
        "material_cost": 180000, "labor_cost": 720000,
        "replacement_cost_reference": 600000,
    },
    # 현관 방화문 — 스틸 규격 문이라 "민자/알판" 개념이 없고, 단면/양면 시공 여부로만 갈린다.
    "FIRE_DOOR_SINGLE": {
        "group": "필름 시공",
        "label": "현관 방화문 리폼 (단면)", "icon": "🚪",
        "chip": ["#2dd4bf", "#14b8a6"], "design_type": None, "film_meters": 4.0,
        "material_cost": 30000, "labor_cost": 120000,
    },
    "FIRE_DOOR_DOUBLE": {
        "group": "필름 시공",
        "label": "현관 방화문 리폼 (양면)", "icon": "🚪",
        "chip": ["#0d9488", "#0f766e"], "design_type": None, "film_meters": 7.0,
        "material_cost": 50000, "labor_cost": 200000,
    },
    "MIDDLE_DOOR": {
        "group": "필름 시공",
        "label": "중문 리폼 세트", "icon": "🚪",
        "chip": ["#94a3b8", "#64748b"], "design_type": None, "film_meters": 8.0,
        "material_cost": 70000, "labor_cost": 280000,
    },
    # ---- 전기/조명·설비 (직접 시공) ----
    # 기본값은 backend/app/pricing_store.py 기본 단가표(본체+설치비 등)를 원자재값/공임비로
    # 나눠 잡은 것이다. 현장 시세에 맞게 사장님이 단가 설정에서 이 숫자만 고치면 된다.
    # note가 없는 품목은 필름 시공 문구가 붙는다.
    "FAN_INSTALL": {
        "group": "전기·조명",
        "label": "실링팬 설치 세트", "icon": "🌀",
        "chip": ["#38bdf8", "#0ea5e9"], "design_type": None, "film_meters": 0.0,
        "material_cost": 180000,  # 실링팬 본체
        "labor_cost": 60000,  # 설치 및 작동 점검
        "note": "실링팬 본체 포함, 설치 및 작동 점검 일체 포함",
    },
    "DOWNLIGHT_NEW": {
        "group": "전기·조명",
        "label": "다운라이트 타공·배선 세트", "icon": "💡",
        "chip": ["#fbbf24", "#f59e0b"], "design_type": None, "film_meters": 0.0,
        "material_cost": 15000,  # 4인치 다운라이트 본체
        "labor_cost": 30000,  # 설치 1만 + 타공 8천 + 배선 2m 1.2만
        "note": "다운라이트 본체 포함, 타공 및 배선 연결(2m 기준), 점등 확인 일체 포함 · 개당",
    },
    "SINK_BOWL_STD": {
        "group": "설비",
        "label": "사각 싱크볼 교환 세트", "icon": "🚰",
        "chip": ["#fb7185", "#f43f5e"], "design_type": "기본형 (850)", "film_meters": 0.0,
        "material_cost": 145000,  # 싱크볼 12만 + 배수구 2.5만
        "labor_cost": 150000,  # 교환 설치
        "note": "싱크볼 및 배수구 포함, 교환 설치 일체 포함",
    },
    "SINK_BOWL_PREMIUM": {
        "group": "설비",
        "label": "고급 사각 싱크볼 교환 세트", "icon": "🚰",
        "chip": ["#f472b6", "#ec4899"], "design_type": "프리미엄 사각", "film_meters": 0.0,
        "material_cost": 275000,  # 프리미엄 싱크볼 25만 + 배수구 2.5만
        "labor_cost": 150000,  # 교환 설치
        "note": "싱크볼 및 배수구 포함, 교환 설치 일체 포함",
    },
    "TOILET_STD": {
        "group": "설비",
        "label": "변기 설치 세트", "icon": "🚽",
        "chip": ["#a3e635", "#84cc16"], "design_type": "일반형 투피스", "film_meters": 0.0,
        "material_cost": 205000,  # 일반형 변기 18만 + 급수호스·앙카 2.5만
        "labor_cost": 110000,  # 기존 변기 철거·폐기 3만 + 설치 공임 8만
        "note": "변기 본체 포함, 기존 변기 철거·폐기 및 급수 연결 일체 포함",
    },
    "TOILET_ONE_PIECE": {
        "group": "설비",
        "label": "원피스 변기 설치 세트", "icon": "🚽",
        "chip": ["#84cc16", "#65a30d"], "design_type": "원피스", "film_meters": 0.0,
        "material_cost": 375000,  # 원피스 변기 35만 + 급수호스·앙카 2.5만
        "labor_cost": 110000,  # 철거 3만 + 설치 공임 8만
        "note": "변기 본체 포함, 기존 변기 철거·폐기 및 급수 연결 일체 포함",
    },
    "TOILET_BIDET": {
        "group": "설비",
        "label": "비데 일체형 변기 설치 세트", "icon": "🚽",
        "chip": ["#4ade80", "#22c55e"], "design_type": "비데 일체형", "film_meters": 0.0,
        "material_cost": 725000,  # 비데 일체형 변기 70만 + 급수호스·앙카 2.5만
        "labor_cost": 110000,  # 철거 3만 + 설치 공임 8만
        "note": "변기 본체 포함, 기존 변기 철거·폐기 및 급수 연결 일체 포함",
    },
}

# ------------------------------------------------------------------
# 1-1. 문짝 난이도 할증 — "민자/알판·무늬" 토글 + 문 크기(가로×세로)에 비례해
#      min_amount~max_amount 사이로 자동 할증된다. DOOR_SET에만 적용된다.
# ------------------------------------------------------------------
DEFAULT_SETTINGS = {
    "MIN_CALLOUT_AMOUNT": 300000,  # 기공 1인 최소 출장비 방어선
    "DEPOSIT_RATE_PERCENT": 15.0,  # 계약금 비율(10~20% 권장, 사장님 조정 가능)
    "DOOR_SURCHARGE_MIN": 20000,
    "DOOR_SURCHARGE_MAX": 50000,
    "DOOR_SURCHARGE_MIN_AREA_M2": 1.6,  # 800×2000mm 안팎의 작은 문
    "DOOR_SURCHARGE_MAX_AREA_M2": 2.2,  # 1000×2200mm 안팎의 큰 문
    # 영업 리포트(교체 vs 필름 비교)용 평균 공사 기간.
    "ROI_DAYS_REPLACEMENT": 4,
    "ROI_DAYS_FILM": 1,
}

# ------------------------------------------------------------------
# 1-2. 별도 청구 옵션 — 기본가에 묻지 않고 체크박스로 켰을 때만 추가되는 항목.
#      기존 실리콘 제거·재시공이 대표적이다(쏘는 기술이 있는 시공자가 추가
#      마진을 남기거나 별도 작업자를 부를 수 있도록 기본가와 분리).
# ------------------------------------------------------------------
ADDON_ITEMS = {
    "SILICONE_RECOAT": {
        "label": "기존 실리콘 제거 및 재시공",
        "material_cost": 15000,
        "labor_cost": 25000,
        "applicable_to": ["DOOR_SET", "SASH_SMALL", "SASH_LARGE", "MOLDING_FLAT", "MOLDING_CROWN"],
    },
}

# 모든 견적 항목 하단에 고정 렌더링되는 '가치 설명' 문구 — 실리콘은 더 이상 여기 포함하지
# 않는다(ADDON_ITEMS로 분리, 기본가에 묻으면 체크박스와 모순된다).
VALUE_INCLUSION_NOTE = "친환경 프라이머 도포, 정밀 평탄화(퍼티), 먼지 제거 및 굴곡부 가열 밀착 작업 일체 포함 · 시공 후 1~2일은 시공면에 물이 닿지 않게 관리"


def _load_overrides() -> dict:
    if not os.path.exists(_PRICING_PATH):
        return {}
    try:
        with open(_PRICING_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        # 파일이 깨졌다고 견적을 못 내면 안 된다 — 기본값으로 조용히 돌아간다.
        return {}


def _save_overrides(values: dict) -> None:
    os.makedirs(_STORAGE_DIR, exist_ok=True)
    current = _load_overrides()
    current.update(values)
    with open(_PRICING_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)


def _cost_key(code: str, field: str) -> str:
    """단가 설정 화면(및 저장 파일)이 쓰는 키. 예: 'DOOR_SET.material_cost'."""
    return f"{code}.{field}"


def effective_settings() -> dict:
    """DEFAULT_SETTINGS(최소 출장비·계약금 비율·할증 범위)에 저장된 조정값을 얹는다."""
    overrides = _load_overrides()
    return {key: overrides.get(key, value) for key, value in DEFAULT_SETTINGS.items()}


def effective_addons() -> dict:
    """ADDON_ITEMS(실리콘 재시공 등)에 저장된 조정값을 얹는다."""
    overrides = _load_overrides()
    out = {}
    for code, addon in ADDON_ITEMS.items():
        material_cost = overrides.get(_cost_key(code, "material_cost"), addon["material_cost"])
        labor_cost = overrides.get(_cost_key(code, "labor_cost"), addon["labor_cost"])
        out[code] = {**addon, "material_cost": material_cost, "labor_cost": labor_cost, "price": material_cost + labor_cost}
    return out


def effective_items() -> dict:
    """기본값에 사장님이 저장한 단가를 덮어쓴 품목 사전. price는 항상
    material_cost + labor_cost로 계산해 반환한다 — 둘 중 하나만 따로 저장·수정해도
    합계가 저절로 맞는다."""
    overrides = _load_overrides()
    items = {}
    for code, item in DEFAULT_ITEMS.items():
        material_cost = overrides.get(_cost_key(code, "material_cost"), item["material_cost"])
        labor_cost = overrides.get(_cost_key(code, "labor_cost"), item["labor_cost"])
        entry = {
            **item,
            "material_cost": material_cost,
            "labor_cost": labor_cost,
            "price": material_cost + labor_cost,
        }
        if "replacement_cost_reference" in item:
            entry["replacement_cost_reference"] = overrides.get(
                _cost_key(code, "replacement_cost_reference"), item["replacement_cost_reference"]
            )
        items[code] = entry
    return items


def _door_set_surcharge(width_mm: int, height_mm: int, design_type: str) -> int:
    """민자(flat)는 할증 0원. 알판·무늬(pattern)는 문 크기(면적)에 비례해
    DOOR_SURCHARGE_MIN~MAX 사이로 보간한다 — 요청하신 '난이도 연동 유닛 단가표'."""
    if design_type != "pattern":
        return 0
    settings = effective_settings()
    area_m2 = (width_mm * height_mm) / 1_000_000 if width_mm and height_mm else settings["DOOR_SURCHARGE_MIN_AREA_M2"]
    min_area = settings["DOOR_SURCHARGE_MIN_AREA_M2"]
    max_area = settings["DOOR_SURCHARGE_MAX_AREA_M2"]
    min_amt = settings["DOOR_SURCHARGE_MIN"]
    max_amt = settings["DOOR_SURCHARGE_MAX"]
    if max_area <= min_area:
        return round(max_amt)
    ratio = (area_m2 - min_area) / (max_area - min_area)
    ratio = max(0.0, min(1.0, ratio))
    return round(min_amt + ratio * (max_amt - min_amt))


SETTINGS_LABELS = {
    "MIN_CALLOUT_AMOUNT": ("최소 출장비", "원"),
    "DEPOSIT_RATE_PERCENT": ("계약금 비율", "%"),
    "DOOR_SURCHARGE_MIN": ("문짝 난이도 할증 (최소)", "원"),
    "DOOR_SURCHARGE_MAX": ("문짝 난이도 할증 (최대)", "원"),
    "ROI_DAYS_REPLACEMENT": ("영업 리포트 — 교체 공사 기간", "일"),
    "ROI_DAYS_FILM": ("영업 리포트 — 필름 시공 기간", "일"),
}


def pricing_fields() -> list[dict]:
    """단가 설정 화면에 뿌릴 목록. 품목 그룹(필름 시공/전기·조명/설비)별로 묶고,
    한 품목의 원자재값·공임비를 나란히 둔다. '오야 방어 로직'(최소 출장비·계약금·
    할증 범위·교체 비용 기준·실리콘 추가비)은 별도 그룹으로 맨 앞에 둔다."""
    overrides = _load_overrides()
    fields = []

    for key, (label, unit) in SETTINGS_LABELS.items():
        default = DEFAULT_SETTINGS[key]
        fields.append({
            "key": key, "label": label, "group": "오야 방어 로직", "unit": unit,
            "value": overrides.get(key, default), "default": default,
        })

    for code, addon in ADDON_ITEMS.items():
        for field_name, field_label, unit in (("material_cost", "원자재값", "원"), ("labor_cost", "공임비", "원")):
            key = _cost_key(code, field_name)
            default = addon[field_name]
            fields.append({
                "key": key, "label": f"{addon['label']} — {field_label}", "group": "오야 방어 로직", "unit": unit,
                "value": overrides.get(key, default), "default": default,
            })

    for code, item in DEFAULT_ITEMS.items():
        for field_name, field_label, unit in (
            ("material_cost", "원자재값", "원"),
            ("labor_cost", "공임비", "원"),
        ):
            key = _cost_key(code, field_name)
            default = item[field_name]
            fields.append({
                "key": key,
                "label": f"{item['label']} — {field_label}",
                "group": item["group"],
                "unit": unit,
                "value": overrides.get(key, default),
                "default": default,
            })
        if "replacement_cost_reference" in item:
            key = _cost_key(code, "replacement_cost_reference")
            default = item["replacement_cost_reference"]
            fields.append({
                "key": key, "label": f"{item['label']} — 교체 비용 기준(영업 멘트)", "group": "오야 방어 로직", "unit": "원",
                "value": overrides.get(key, default), "default": default,
            })
    return fields


@app.route("/")
def index():
    return render_template("estimator.html", items=effective_items(), value_note=VALUE_INCLUSION_NOTE)


@app.route("/api/items", methods=["GET"])
def get_items():
    """프론트엔드 비주얼 선택 그리드 렌더링용 품목 목록."""
    return jsonify(effective_items())


@app.route("/api/pricing", methods=["GET"])
def get_pricing():
    """단가 설정 화면(원자재값·공임비)이 읽는 목록."""
    return jsonify({"fields": pricing_fields()})


@app.route("/api/pricing", methods=["PUT"])
def update_pricing():
    """단가 설정 화면에서 고친 값을 저장한다.
    요청 예: { "values": { "DOOR_FLAT.material_cost": 40000 } }"""
    data = request.get_json(force=True, silent=True) or {}
    values = data.get("values", {})
    if not isinstance(values, dict):
        return jsonify({"detail": "values 형식이 올바르지 않습니다."}), 422

    valid_keys = {_cost_key(code, field) for code in DEFAULT_ITEMS for field in ("material_cost", "labor_cost")}
    valid_keys |= {
        _cost_key(code, "replacement_cost_reference") for code, item in DEFAULT_ITEMS.items() if "replacement_cost_reference" in item
    }
    valid_keys |= {_cost_key(code, field) for code in ADDON_ITEMS for field in ("material_cost", "labor_cost")}
    valid_keys |= set(DEFAULT_SETTINGS)
    cleaned = {}
    for key, value in values.items():
        if key not in valid_keys:
            continue  # 모르는 항목은 조용히 무시 — 예전 화면이 보낸 낡은 키가 섞여도 저장이 깨지지 않는다.
        try:
            num = float(value)
        except (TypeError, ValueError):
            return jsonify({"detail": f"'{key}' 값이 숫자가 아닙니다."}), 422
        if num < 0:
            return jsonify({"detail": f"'{key}' 값은 0보다 작을 수 없습니다."}), 422
        cleaned[key] = num

    _save_overrides(cleaned)
    return jsonify({"fields": pricing_fields()})


def _pick_roi_breakdown_item(breakdown: list[dict]) -> dict | None:
    """교체 비용 기준값(replacement_cost_reference)이 있는 품목 중 금액이 가장 큰 것을
    고른다. sales_pitch(문장)와 roi_comparison(막대그래프용 숫자)이 항상 같은 기준으로
    계산되도록 이 함수 하나만 쓴다."""
    candidates = [b for b in breakdown if b.get("replacement_cost_reference") and b["line_total"] > 0]
    if not candidates:
        return None
    best = max(candidates, key=lambda b: b["line_total"])
    ref = best["replacement_cost_reference"]
    if best["line_total"] >= ref:
        return None
    return {"item_name": best["label"], "film_cost": best["line_total"], "replacement_cost": ref}


def _sales_pitch_from_breakdown(roi_item: dict | None) -> str:
    if roi_item is None:
        return ""
    savings_percent = round((1 - roi_item["film_cost"] / roi_item["replacement_cost"]) * 100)
    return (
        f"{roi_item['item_name']} 전체 교체 시 평균 {roi_item['replacement_cost']:,.0f}원 이상 소요되지만, "
        f"필름 리폼은 {roi_item['film_cost']:,.0f}원으로 교체 대비 약 {savings_percent}% 저렴하며 "
        "원하는 색상으로 일체감 있는 마감이 가능합니다."
    )


def _roi_comparison_from_breakdown(roi_item: dict | None, settings: dict) -> dict | None:
    if roi_item is None:
        return None
    days_replacement = int(settings["ROI_DAYS_REPLACEMENT"])
    days_film = int(settings["ROI_DAYS_FILM"])
    savings_percent = round((1 - roi_item["film_cost"] / roi_item["replacement_cost"]) * 100)
    return {
        "item_name": roi_item["item_name"],
        "replacement_cost": roi_item["replacement_cost"],
        "film_cost": roi_item["film_cost"],
        "savings_percent": savings_percent,
        "days_replacement": days_replacement,
        "days_film": days_film,
        "highlights": [
            f"비용 {savings_percent}% 절감",
            f"공기 단축 ({days_replacement}일 → {days_film}일)",
            "소음·분진 없음",
        ],
    }


@app.route("/api/calculate", methods=["POST"])
def calculate():
    """
    선택된 품목/수량을 받아 견적을 계산한다.
    요청 예: {
      "selections": { "DOOR_SET": 2, "SASH_LARGE": 1 },
      "door_detail": { "design_type": "pattern", "width_mm": 900, "height_mm": 2100 },
      "addons": { "SASH_LARGE": ["SILICONE_RECOAT"] }
    }
    door_detail은 DOOR_SET 수량 전체에 같은 크기/디자인을 적용한다(빠른 견적은
    "같은 사이즈 문짝 N개"가 흔한 요청이라 세트마다 다른 크기까지는 받지 않는다 —
    짝마다 다른 정밀 견적이 필요하면 AI 시공 사진 견적을 쓴다).
    """
    data = request.get_json(force=True, silent=True) or {}
    selections = data.get("selections", {})
    door_detail = data.get("door_detail") or {}
    addons_req = data.get("addons", {})
    items = effective_items()
    addons = effective_addons()
    settings = effective_settings()

    breakdown = []
    raw_total = 0
    film_meters_total = 0.0
    material_cost_total = 0

    for code, qty in selections.items():
        if code not in items:
            continue
        try:
            qty = int(qty)
        except (TypeError, ValueError):
            continue
        if qty <= 0:
            continue

        item = items[code]
        surcharge_per_unit = 0
        design_type_label = item["design_type"]
        if code == "DOOR_SET":
            design_type = door_detail.get("design_type") or "flat"
            surcharge_per_unit = _door_set_surcharge(
                door_detail.get("width_mm") or 0, door_detail.get("height_mm") or 0, design_type
            )
            design_type_label = "민자/평판 타입" if design_type == "flat" else "웨인스코팅/알판/무늬 타입"

        unit_price = item["price"] + surcharge_per_unit
        line_total = unit_price * qty
        raw_total += line_total
        film_meters_total += item["film_meters"] * qty
        material_cost_total += item["material_cost"] * qty

        breakdown.append({
            "code": code,
            "label": item["label"],
            "icon": item["icon"],
            "design_type": design_type_label,
            "unit_price": unit_price,
            "surcharge_per_unit": surcharge_per_unit,
            "note": item.get("note") or VALUE_INCLUSION_NOTE,
            "qty": qty,
            "line_total": line_total,
            "replacement_cost_reference": item.get("replacement_cost_reference"),
        })

        for addon_code in addons_req.get(code, []):
            addon = addons.get(addon_code)
            if not addon or code not in addon["applicable_to"]:
                continue
            addon_total = addon["price"] * qty
            raw_total += addon_total
            material_cost_total += addon["material_cost"] * qty
            breakdown.append({
                "code": f"{code}__{addon_code}",
                "label": f"{addon['label']} ({item['label']})",
                "icon": "🧴",
                "design_type": None,
                "unit_price": addon["price"],
                "surcharge_per_unit": 0,
                "note": "기본가에 포함되지 않는 별도 청구 항목입니다.",
                "qty": qty,
                "line_total": addon_total,
                "replacement_cost_reference": None,
            })

    # ── 최소 출장비 방어선 ──
    min_callout_amount = settings["MIN_CALLOUT_AMOUNT"]
    min_callout_applied = 0 < raw_total < min_callout_amount
    total = min_callout_amount if min_callout_applied else raw_total
    min_callout_note = (
        f"해당 시공은 하루 스케줄이 소요되므로, 기공 1인 최소 출장비({min_callout_amount:,.0f}원)가 일괄 적용되었습니다."
        if min_callout_applied else ""
    )

    # ── 계약금(스케줄 락다운) ──
    deposit_rate = settings["DEPOSIT_RATE_PERCENT"]
    deposit = {
        "rate_percent": deposit_rate,
        "amount": round(total * deposit_rate / 100),
        "note": "지정된 날짜의 스케줄 확정을 위한 계약금이며, 단순 변심 및 당일 취소 시 환불이 불가합니다.",
    }

    labor_margin = total - material_cost_total
    # 품목 구성에 따른 실효 자재비 비율 (필름만 고르면 대략 20%대)
    eff_ratio = material_cost_total / total if total else 0.0
    roi_item = _pick_roi_breakdown_item(breakdown)

    return jsonify({
        "breakdown": breakdown,
        "total": total,
        "raw_total": raw_total,
        "min_callout_applied": min_callout_applied,
        "min_callout_note": min_callout_note,
        "deposit": deposit,
        "sales_pitch": _sales_pitch_from_breakdown(roi_item),
        "roi_comparison": _roi_comparison_from_breakdown(roi_item, settings),
        "value_note": VALUE_INCLUSION_NOTE,
        # 사장님 전용 스텔스 원가 분석 패널 데이터 - 고객 화면에는 절대 렌더링되지 않는다.
        "margin_analysis": {
            "film_meters": round(film_meters_total, 1),
            "material_cost": material_cost_total,
            "material_ratio": eff_ratio,
            "labor_margin": labor_margin,
            "labor_margin_ratio": 1 - eff_ratio,
        },
    })


if __name__ == "__main__":
    # 외부 공개(ngrok) 시 Werkzeug 디버거(원격 코드 실행 가능)를 켜면 안 되므로 기본은 꺼둔다.
    app.run(host="0.0.0.0", port=5050, debug=False)
