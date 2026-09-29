"""꾸밍홈 인테리어 필름 - 가치 기반(Value-Based) 프리미엄 견적 앱 백엔드.

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
    "DOOR_FLAT": {
        "group": "필름 시공",
        "label": "민자 도어 리폼 세트", "icon": "🚪",
        "chip": ["#60a5fa", "#3b82f6"], "design_type": "민자/평판 타입", "film_meters": 4.0,
        "material_cost": 36000, "labor_cost": 144000,
    },
    "DOOR_CURVED": {
        "group": "필름 시공",
        "label": "굴곡 도어 리폼 세트", "icon": "🚪",
        "chip": ["#818cf8", "#6366f1"], "design_type": "웨인스코팅/알판/굴곡 타입", "film_meters": 5.5,
        "material_cost": 50000, "labor_cost": 200000,
    },
    "SASH_SMALL": {
        "group": "필름 시공",
        "label": "방창 리폼 세트", "icon": "🪟",
        "chip": ["#34d399", "#10b981"], "design_type": None, "film_meters": 3.0,
        "material_cost": 30000, "labor_cost": 120000,
    },
    "SASH_LARGE": {
        "group": "필름 시공",
        "label": "거실 대창 리폼 세트", "icon": "🪟",
        "chip": ["#22d3ee", "#06b6d4"], "design_type": None, "film_meters": 5.0,
        "material_cost": 36000, "labor_cost": 144000,
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
    },
    "MOLDING_CROWN": {
        "group": "필름 시공",
        "label": "장식 몰딩 라인 세트", "icon": "📐",
        "chip": ["#c084fc", "#a855f7"], "design_type": "웨인스코팅/알판/굴곡 타입", "film_meters": 22.0,
        "material_cost": 180000, "labor_cost": 720000,
    },
    "ENTRANCE": {
        "group": "필름 시공",
        "label": "현관 도어 리폼 세트", "icon": "🚪",
        "chip": ["#2dd4bf", "#14b8a6"], "design_type": None, "film_meters": 6.0,
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

# 모든 견적 항목 하단에 고정 렌더링되는 '가치 설명' 문구
VALUE_INCLUSION_NOTE = "기존 실리콘 제거, 친환경 프라이머 도포 및 정밀 평탄화(퍼티) 작업 일체 포함"


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
    """단가 설정 화면(및 저장 파일)이 쓰는 키. 예: 'DOOR_FLAT.material_cost'."""
    return f"{code}.{field}"


def effective_items() -> dict:
    """기본값에 사장님이 저장한 단가를 덮어쓴 품목 사전. price는 항상
    material_cost + labor_cost로 계산해 반환한다 — 둘 중 하나만 따로 저장·수정해도
    합계가 저절로 맞는다."""
    overrides = _load_overrides()
    items = {}
    for code, item in DEFAULT_ITEMS.items():
        material_cost = overrides.get(_cost_key(code, "material_cost"), item["material_cost"])
        labor_cost = overrides.get(_cost_key(code, "labor_cost"), item["labor_cost"])
        items[code] = {
            **item,
            "material_cost": material_cost,
            "labor_cost": labor_cost,
            "price": material_cost + labor_cost,
        }
    return items


def pricing_fields() -> list[dict]:
    """단가 설정 화면에 뿌릴 목록. 품목 그룹(필름 시공/전기·조명/설비)별로 묶고,
    한 품목의 원자재값·공임비를 나란히 둔다."""
    overrides = _load_overrides()
    fields = []
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

    valid_keys = {
        _cost_key(code, field) for code in DEFAULT_ITEMS for field in ("material_cost", "labor_cost")
    }
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


@app.route("/api/calculate", methods=["POST"])
def calculate():
    """
    선택된 품목/수량을 받아 견적을 계산한다.
    요청 예: { "selections": { "DOOR_CURVED": 2, "SASH_LARGE": 1 } }
    """
    data = request.get_json(force=True, silent=True) or {}
    selections = data.get("selections", {})
    items = effective_items()

    breakdown = []
    total = 0
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
        line_total = item["price"] * qty
        total += line_total
        film_meters_total += item["film_meters"] * qty
        material_cost_total += item["material_cost"] * qty

        breakdown.append({
            "code": code,
            "label": item["label"],
            "icon": item["icon"],
            "design_type": item["design_type"],
            "unit_price": item["price"],
            "note": item.get("note") or VALUE_INCLUSION_NOTE,
            "qty": qty,
            "line_total": line_total,
        })

    labor_margin = total - material_cost_total
    # 품목 구성에 따른 실효 자재비 비율 (필름만 고르면 대략 20%대)
    eff_ratio = material_cost_total / total if total else 0.0

    return jsonify({
        "breakdown": breakdown,
        "total": total,
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
