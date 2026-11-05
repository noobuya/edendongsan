"""사장님 업체 정보. 블로그 후기 글 하단 서명과 공개 블로그 배너에 쓰인다.

전화번호처럼 정확해야 하는 값은 AI가 생성하는 본문에 맡기지 않고 여기 값을
그대로 붙여넣는다 — LLM이 숫자를 한두 자리 잘못 옮겨 적을 위험을 원천 차단하기
위함이다 (app/services/blog_writer.py의 서명 블록 참고).

[왜 — 2026-11-05 사장님 요청 "상호명·전화번호를 설정에서 직접 바꿀 수 있게"]
지금까지는 이 값들이 코드에 박힌 상수라, 바꾸려면 코드를 고쳐 다시 배포해야
했다. pricing_store.py와 같은 override 패턴으로 바꿔, /admin/brand에서 저장한
값이 storage/business_info.json에 남고 이후 모든 곳(블로그 서명·배너·영수증
워터마크 등)에 바로 반영되게 한다. 기본값(DEFAULT_*)은 그대로 남겨 둬, 한 번도
설정하지 않은 새 설치본에서도 안전하게 동작한다."""
import json
from pathlib import Path

from app.config import get_settings

DEFAULT_BUSINESS_NAME = "대한인테리어필름"
DEFAULT_BUSINESS_PHONE = "010-8134-0100"
DEFAULT_REPRESENTATIVE_NAME = ""
DEFAULT_SERVICE_AREA = "대구 전지역 및 경북 지역 출장 가능"
# 블로그 제목 말머리("[대구 인테리어 필름]")처럼 짧게 들어가야 하는 자리용 —
# service_area()는 "~출장 가능"까지 붙어 있어 제목에 그대로 쓰면 어색하다.
DEFAULT_SERVICE_AREA_SHORT = "대구"

# [왜 — 2026-11-05 사장님 요청 "사람이 제일 많이 검색하는 키워드를 올려줘 / 대구·
# 테크노폴리스·달성군·현풍·텍폴 지역도 무조건 넣어줘"]
# AI가 매번 새로 만드는 해시태그만 믿으면 "테크노폴리스"·"현풍"·"텍폴"처럼 사장님이
# 콕 집은 핵심 동네 검색어를 빠뜨리거나 표기를 다르게 쓸 수 있다 — 전화번호를 AI에게
# 맡기지 않고 고정값으로 붙이는 것과 같은 이유로, 이 목록은 services/blog_writer.py가
# 모든 블로그 글의 해시태그 맨 앞에 그대로 붙인다(AI가 만든 글 내용별 태그는 그
# 뒤에 이어진다). 서비스 키워드(싱크대시트지·필름시공 등) × 지역 조합이 실제 네이버
# 검색에서 가장 많이 쓰이는 형태라 그대로 넣는다. (이 목록은 상호명과 달리 지역
# SEO 전략값이라 설정 화면에서 바꾸는 대상이 아니다 — 그대로 둔다.)
BUSINESS_CORE_HASHTAGS = [
    "#대구시트지시공",
    "#대구싱크대시트지",
    "#테크노폴리스필름시공",
    "#테크노폴리스싱크대시트지",
    "#대구",
    "#테크노폴리스",
    "#달성군",
    "#현풍",
    "#텍폴",
]

_FIELDS = ("business_name", "phone", "representative_name", "service_area", "service_area_short")
_DEFAULTS = {
    "business_name": DEFAULT_BUSINESS_NAME,
    "phone": DEFAULT_BUSINESS_PHONE,
    "representative_name": DEFAULT_REPRESENTATIVE_NAME,
    "service_area": DEFAULT_SERVICE_AREA,
    "service_area_short": DEFAULT_SERVICE_AREA_SHORT,
}


def _path() -> Path:
    p = Path(get_settings().storage_dir) / "business_info.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load_overrides() -> dict:
    p = _path()
    if not p.exists():
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        # 파일이 깨졌다고 상호명이 안 뜨면 안 된다 — 기본값으로 조용히 돌아간다.
        return {}


def effective() -> dict:
    """기본값 위에 사장님이 설정에서 바꾼 값을 얹는다. 빈 문자열로 저장된 값은
    "지웠다"는 뜻이 아니라 "비워 뒀다"는 뜻이라, representative_name처럼 원래
    기본값이 빈 문자열인 필드를 제외하면 기본값 쪽으로 돌아간다(전화번호를
    실수로 빈 값으로 저장해 서명이 깨지는 사고를 막는다)."""
    overrides = _load_overrides()
    return {field: overrides.get(field) or _DEFAULTS[field] for field in _FIELDS}


def save_overrides(values: dict) -> dict:
    current = _load_overrides()
    for field in _FIELDS:
        if field in values and values[field] is not None:
            current[field] = values[field]
    p = _path()
    tmp = p.with_suffix(".tmp.json")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False)
    tmp.replace(p)
    return effective()


def business_name() -> str:
    return effective()["business_name"]


def business_phone() -> str:
    return effective()["phone"]


def representative_name() -> str:
    return effective()["representative_name"]


def service_area() -> str:
    return effective()["service_area"]


def service_area_short() -> str:
    return effective()["service_area_short"]


def phone_tel_href() -> str:
    return f"tel:{business_phone().replace('-', '')}"
