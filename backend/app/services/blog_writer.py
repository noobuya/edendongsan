"""완료된 시공 견적과 현장 사진을 바탕으로 Gemini가 블로그 후기 글을 작성한다.

사장님이 시공 후기를 검색엔진에 노출시키려면 매번 사진을 보며 글을 새로 쓰는
수고가 드는데, 이 서비스가 그 초안을 자동으로 만들어준다. 실제로 저장된
사진(원본/현장 작업 사진/시공 후 사진)만 근거로 삼도록 강제해, 사진에 없는
내용(브랜드명, 존재하지 않는 옵션 등)을 지어내는 것을 프롬프트에서 명시적으로
막는다 — 이 앱은 사장님이 실제로 수행한 자기 시공 건에 대한 글을 쓰는 것이라
"가짜 후기"가 아니라 본인 포트폴리오 콘텐츠 초안이며, 사장님이 발행 전에
검수/수정한다는 전제로 설계했다.
"""
from datetime import datetime, timezone

from google import genai
from google.genai import errors as genai_errors
from PIL import Image

from app.business_info import (
    BUSINESS_NAME,
    BUSINESS_PHONE,
    BUSINESS_SERVICE_AREA,
    BUSINESS_SERVICE_AREA_SHORT,
)
from app.config import get_settings
from app.services.timeouts import run_gemini_with_retry

GEMINI_MODEL = "gemini-flash-latest"
BLOG_TIMEOUT_S = 30
MAX_REFERENCE_PHOTOS = 6
# 재시도 총량. 이미지+생성 요청이 과부하 상태일 때 1회 시도가 최대 BLOG_TIMEOUT_S초
# 걸릴 수 있어, 재시도 횟수를 늘릴수록 사용자가 버튼을 누르고 기다리는 시간이
# 선형으로 늘어난다 — 3회 재시도(대기 5→10→20초)면 최악의 경우에도 약 2분
# 안팎이라 "버튼 누르고 기다릴 만한" 수준을 넘지 않게 잡았다.
BLOG_MAX_RETRIES = 3
BLOG_RETRY_WAIT_S = 5.0
BLOG_BACKOFF_FACTOR = 2.0

TITLE_MARKER = "제목:"
CONTENT_MARKER = "본문:"
PROMISE_MARKER = "약속:"
CLOSING_MARKER = "마무리:"
TIPS_MARKER = "팁:"
HASHTAG_MARKER = "해시태그:"
SECTION_MARKERS = [TITLE_MARKER, CONTENT_MARKER, PROMISE_MARKER, CLOSING_MARKER, TIPS_MARKER, HASHTAG_MARKER]
MAX_HASHTAGS = 10

# response_mime_type="application/json"(구조화 출력)은 쓰지 않는다 — 실측 결과
# 이 계정/시점에서 "이미지 첨부 + JSON 모드"를 함께 쓸 때 503(UNAVAILABLE, 과부하)
# 비율이 유독 높았다(반복 호출 시 약 90% 실패, 같은 요청에서 JSON 모드만 뺐더니
# 실패율이 크게 낮아짐). 대신 마커로 구분한 일반 텍스트를 받아 직접 파싱한다 —
# 형식이 살짝 어긋나도 _parse_response()가 방어적으로 처리한다.
#
# 섹션을 6개로 나눈 이유: 실제 인테리어 시공 후기 블로그들(네이버 상위 노출
# 글 다수)을 참고하면 "도입부(현장 개요+의뢰 배경)" -> "본문(비포/애프터
# 스토리텔링+전문성 어필)" -> "업체의 약속" -> "마무리+CTA" -> "체크포인트"
# 구조가 공통적으로 쓰인다. 내용은 항상 사진·실제 기록된 시공 데이터에 근거하거나
# 일반적인 조언 수준으로 제한해, 검증 불가능한 사실은 지어내지 않는다.
#
# [2026-10 2차 개편 — 에세이형 페르소나 + 조공 헌사] 1차 개편(수석 실장 + SEO
# 파워블로거, 이모지 금지)에 이어 사장님이 톤을 한 번 더 조정했다: 이번엔 "진정성
# 있는 스토리텔링으로 감동을 주는" 에세이에 가깝게, 그리고 "함께 땀 흘린 수강생
# (조공)들에게 자부심을 느끼게 하는" 문단을 필수로 넣어달라고 했다. 조공에 대한
# 헌사는 특정 인물·특정 행동을 지목하는 게 아니라(검증 불가능한 구체적 사실 주장이
# 아니라) "우리 팀/조공분들"처럼 일반적인 팀워크 묘사라, 브랜드명처럼 사실관계를
# 틀릴 위험이 없다 — 이 업체가 실제로 운영하는 수강생 현장 매칭 구조(recruiting
# 도메인) 자체가 실재하는 사실이라 지어낸 설정도 아니다. 마무리의 "고객이 기뻐하는
# 모습"은 사장님이 직접 "가상의 묘사"를 허용한 유일한 예외 지점 — 감정선을 위한
# 문학적 장치임을 분명히 알려 다른 항목(브랜드·공정 등)까지 상상으로 번지지 않게 한다.
PROMPT_TEMPLATE = (
    "당신은 10년 이상의 현장 경험을 가진 프리미엄 인테리어 필름 시공팀의 수석 실장이자, "
    "진정성 있는 스토리텔링으로 독자에게 깊은 감동을 주는 네이버 파워블로거다. 첨부된 시공 "
    "전/작업 중/후 사진과 아래 실제 시공 내역을 바탕으로, 고객에게는 내 집이 아름답게 변한 "
    "감동을, 함께 땀 흘린 수강생(조공)들에게는 일에 대한 벅찬 자부심을 느끼게 해주는 한 편의 "
    "에세이 같은 시공 후기를 한국어로 작성하라.\n"
    "시공 항목: {item_names}\n"
    "사용 자재(실제 발주 품번 — 반드시 이 명칭 그대로 인용하고 다른 브랜드를 지어내지 마라): "
    "{material_names}\n"
    "지역: {service_area}\n"
    "이 업체가 모든 현장에서 항상 지키는 표준 시공 공정(지어낸 디테일이 아니라 실제 원칙이니 "
    "본문에 자연스럽게 녹여 설명할 것): {standard_process}\n"
    "요구사항:\n"
    "- [금지] 이모지(아이콘, 특수기호 그림 등)와 가벼운 통신어체는 절대 쓰지 마라. 전문가의 "
    "묵직함과 인간적인 따뜻함이 공존하는 정중한 '해요/요' 또는 '합니다/다' 체로 쓴다.\n"
    "- 실제로 사진에 보이는 내용(색상, 부위, 분위기 변화)을 근거로 서술하고, 위에 주어지지 않은 "
    "내용(존재하지 않는 브랜드, 자격증, 수상 이력, 옵션)은 절대 지어내지 마라. 단, 마무리 항목의 "
    "고객 반응 묘사만은 예외로 감정을 살리는 정도의 상상을 허용한다(아래 '마무리' 항목 참고).\n"
    "- 견적/시공 비용 금액은 어떤 항목에도 절대 적지 마라 — 공개 블로그 글에는 가격을 노출하지 "
    "않는다(비용 문의는 전화 상담으로 유도한다).\n"
    "- 제목은 '[{service_area_short} 인테리어 필름]'으로 시작하고, 공간의 변화가 가져온 감동을 "
    "담담하고 세련되게 표현한다(예: '[대구 인테리어 필름] 낡은 샷시에 스며든 따뜻한 화이트, "
    "가족의 새로운 일상을 열다'). 고객 이름은 제목에 넣지 않는다.\n"
    "- '본문' 항목은 다음 흐름으로 3~5문단 작성한다. 먼저 현장에 처음 들어섰을 때 고객이 안고 "
    "있던 깊은 고민(답답한 색감, 좁아 보이는 공간, 스크래치 등 사진에서 드러나는 문제)을 따뜻한 "
    "시선으로 공감하며 열고, 이 공간이 단순한 집이 아니라 '가족의 소중한 안식처'임을 이해하고 "
    "다가가는 전문가의 진심을 담는다. 이어서 비포/애프터의 변화를 '색이 바뀌었다'가 아니라 "
    "'공간의 온도가 달라졌다'는 느낌으로 묘사하고, 위에 주어진 자재 명칭을 정확히 언급하며 "
    "내구성·질감의 장점을 설명한다. [필수] 보이지 않는 밑작업부터 손끝이 부르트도록 정성스럽게 "
    "샌딩해 준 우리 조공(수강생)들의 구슬땀이 있었기에 가능한 결과라는 점, 묵묵히 제 몫을 해내며 "
    "성장해가는 팀원들이 자랑스럽다는 점을 한 문단에 따뜻하게 담아 조공들이 이 글을 읽고 자부심을 "
    "느끼게 한다(특정 이름이나 검증 불가능한 구체적 일화는 지어내지 말고, '우리 조공들', "
    "'우리 팀원들'처럼 일반적으로 묘사할 것). 마지막으로 위에 주어진 표준 시공 공정을 한 문단 "
    "반드시 포함해 타협하지 않는 디테일을 보여준다. 중요한 내용(자재명, 핵심 공정, 특장점)은 "
    "마크다운 볼드체(앞뒤에 ** 를 붙이는 방식)로 강조한다. 한 문단은 2~3줄 이내로 짧게 끊는다.\n"
    "- '약속' 항목은 이 업체가 지키는 원칙을 2~3개, 각 줄을 '- '로 시작해서 적는다(꼼꼼한 마무리, "
    "시공 전 원인 파악 후 작업 등 — 검증 불가능한 자격증·수상 이력 언급 금지).\n"
    "- '마무리' 항목은 확 바뀐 공간을 보고 환하게 웃으시던 고객님의 모습(이 부분만 감정을 살리는 "
    "정도의 상상을 허용함)이나 시공을 마친 팀의 벅찬 보람을 그리며 여운을 남기고, '1년 무상 "
    "A/S 보증'을 언급해 끝까지 책임진다는 무게감을 보여준 뒤, '새로운 변화가 필요하시다면, "
    "언제든 현장 사진과 함께 편하게 연락 주십시오' 같은 텍스트 위주의 정중한 상담 안내로 "
    "마무리한다.\n"
    "- '팁' 항목은 '전문업체를 고를 때 확인하면 좋은 점 3가지'를 번호(1. 2. 3.)를 붙여 "
    "한 줄씩 적는다 — 일반적으로 통용되는 조언 수준으로 쓰고 특정 경쟁사를 비방하지 않는다.\n"
    "- 과장된 허위 광고 문구(예: '국내 1위', '평생 보장') 없이, 담백하고 진정성 있는 톤으로 쓴다.\n"
    "- 어떤 항목에도 전화번호나 출장 가능 지역 문구를 그대로 적지 마라 — 그 정보는 글 앞뒤에 "
    "고정된 배너/문구로 자동으로 붙으므로, 잘못된 번호를 지어낼 위험이 있다.\n"
    "- '해시태그' 항목은 네이버 블로그 검색 노출에 쓸 해시태그를 8~10개, 지역명·시공 "
    "항목·'인테리어필름'처럼 실제로 검색될 법한 단어와 '#공간의위로' '#장인정신' 같은 감성 "
    "키워드를 섞어 적는다. 각 태그는 '#'로 시작하고 띄어쓰기 없이 한 줄에 공백으로 나열한다.\n"
    "- 다른 설명 없이 정확히 이 형식으로만 답하라(아래 여섯 줄의 마커를 그대로, 이 순서대로 포함할 것):\n"
    f"{TITLE_MARKER} (블로그 제목 한 줄)\n"
    f"{CONTENT_MARKER}\n(도입부 공감+스토리텔링+조공 헌사+전문성 어필, 3~5문단)\n"
    f"{PROMISE_MARKER}\n(약속 2~3줄)\n"
    f"{CLOSING_MARKER}\n(여운+A/S 보증 언급+상담 안내)\n"
    f"{TIPS_MARKER}\n(전문업체 체크포인트 3줄)\n"
    f"{HASHTAG_MARKER} (해시태그 8~10개, 한 줄)"
)

# 모든 현장에서 공통으로 지키는 표준 공정 — "전문가만 아는 디테일" 문단이 지어낸
# 이야기가 아니라 실제 이 업체의 표준 작업 원칙임을 모델에게 알려준다(날씨 연동
# 하자 방지 주의보가 같은 프라이머·열풍기 기준을 쓰는 것과 같은 맥락 —
# services/weather_advisory.py 참고).
STANDARD_PROCESS_NOTE = (
    "수성 프라이머를 도포해 부착력을 극대화하고, 굴곡진 엣지 부분은 고온 열풍기로 처리해 "
    "들뜸 현상을 원천 차단하며, 기존 실리콘을 깔끔히 제거한 뒤 칼선 마감에 심혈을 기울인다"
)


def generate_blog_post(quote: dict) -> dict:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("Gemini API 키가 설정되어 있지 않습니다.")

    images = _collect_reference_images(quote)
    if not images:
        raise RuntimeError("참고할 시공 사진이 없습니다. 현장 사진을 먼저 등록해주세요.")

    estimate = quote.get("estimate") or {}
    item_names = [li.get("item_name", "") for li in estimate.get("line_items", [])]
    # 자재명은 material_orders(app.schemas.MaterialOrderLine)의 실제 발주 품번에서만
    # 가져온다 — 모델이 브랜드를 지어내지 않도록 이 파일 상단 설명과 같은 원칙으로
    # 실제 값을 프롬프트에 직접 박아 넣는다. 발주 기록이 없으면(구형 견적 등) 모델이
    # 안전하게 일반 표현으로 쓰게끔 "(발주 기록 없음 — 특정 브랜드를 지어내지 말고
    # 일반적인 표현으로 서술)"이라고 명시한다.
    material_names = ", ".join(
        m.get("name", "") for m in estimate.get("material_orders", []) if m.get("name")
    ) or "(발주 기록 없음 — 특정 브랜드를 지어내지 말고 '고급 인테리어 필름' 같은 일반적인 표현으로 서술)"

    prompt = PROMPT_TEMPLATE.format(
        customer_name=quote.get("customer_name") or "고객님",
        item_names=", ".join(item_names) or "인테리어 시공",
        material_names=material_names,
        service_area=BUSINESS_SERVICE_AREA,
        service_area_short=BUSINESS_SERVICE_AREA_SHORT,
        standard_process=STANDARD_PROCESS_NOTE,
        business_name=BUSINESS_NAME,
    )

    client = genai.Client(api_key=settings.gemini_api_key)
    try:
        response = run_gemini_with_retry(
            client.models.generate_content,
            BLOG_TIMEOUT_S,
            model=GEMINI_MODEL,
            contents=[prompt, *images],
            max_retries=BLOG_MAX_RETRIES,
            retry_wait_s=BLOG_RETRY_WAIT_S,
            backoff_factor=BLOG_BACKOFF_FACTOR,
            retry_on_timeout=True,
        )
    except genai_errors.APIError as exc:
        if exc.code == 503:
            raise RuntimeError(
                "Gemini가 일시적으로 과부하 상태입니다. 크레딧/키 문제는 아니니 "
                "잠시 후 '다시 생성하기'를 눌러주세요."
            ) from exc
        raise

    sections = _parse_sections(response.text)
    title = sections[TITLE_MARKER] or "시공 후기"
    content = _assemble_content(sections)
    hashtags = _parse_hashtags(sections[HASHTAG_MARKER])
    return {
        "title": title,
        "content": content,
        "hashtags": hashtags,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _signature_block() -> str:
    """전화번호/상호명은 LLM이 지어내면 안 되는 값이라, 본문과 별개로 여기서
    고정 문구를 붙인다. 프론트엔드가 본문을 빈 줄(\\n\\n) 기준으로 문단을 나눠
    렌더링하므로, 이 블록도 독립된 문단으로 보이도록 앞에 빈 줄을 하나 둔다.
    이모지 없이 정중한 톤을 유지한다(2026-10 수석 실장 페르소나 개편 — 이 파일
    상단 PROMPT_TEMPLATE 설명 참고)."""
    return f"문의: {BUSINESS_NAME} {BUSINESS_PHONE}\n{BUSINESS_SERVICE_AREA}"


def _assemble_content(sections: dict[str, str]) -> str:
    """5개 섹션을 실제 시공 후기 블로그에서 흔한 순서(본문 -> 약속 -> 마무리 -> 팁 ->
    문의 배너)로 조립한다. 약속/팁은 불릿·번호가 붙은 목록이라 소제목을 앞에 붙여
    한눈에 섹션이 구분되게 한다(이모지 없는 소제목 — 위 _signature_block 참고)."""
    blocks = [sections[CONTENT_MARKER]]

    promise = sections[PROMISE_MARKER]
    if promise:
        blocks.append(f"{BUSINESS_NAME}의 약속\n{promise}")

    closing = sections[CLOSING_MARKER]
    if closing:
        blocks.append(closing)

    tips = sections[TIPS_MARKER]
    if tips:
        blocks.append(f"전문업체를 고를 때 확인하면 좋은 점\n{tips}")

    blocks.append(_signature_block())
    return "\n\n".join(b for b in blocks if b)


def _parse_sections(text: str) -> dict[str, str]:
    """5개 마커(제목/본문/약속/마무리/팁)로 구분된 응답을 파싱한다. 모델이 마커
    일부를 빠뜨리거나 순서를 바꿔도(실측: 가끔 콜론을 빼먹는 경우가 있었다)
    찾은 마커만으로 최대한 구간을 나누고, 못 찾은 섹션은 빈 문자열로 둔다 —
    _assemble_content()가 빈 섹션은 자동으로 건너뛴다."""
    text = text.strip()
    positions = [(m, text.find(m)) for m in SECTION_MARKERS]
    found = sorted((idx, marker) for marker, idx in positions if idx != -1)

    sections = {m: "" for m in SECTION_MARKERS}
    if not found:
        # 마커를 하나도 못 찾으면 첫 줄을 제목, 나머지를 본문으로 취급한다.
        lines = text.split("\n", 1)
        sections[TITLE_MARKER] = lines[0].strip().lstrip("#").strip() or "시공 후기"
        sections[CONTENT_MARKER] = lines[1].strip() if len(lines) > 1 else text
        return sections

    for i, (start_idx, marker) in enumerate(found):
        end_idx = found[i + 1][0] if i + 1 < len(found) else len(text)
        sections[marker] = text[start_idx + len(marker) : end_idx].strip()

    if not sections[TITLE_MARKER]:
        sections[TITLE_MARKER] = "시공 후기"
    if not sections[CONTENT_MARKER]:
        # 본문이 비면 글이 사실상 빈 페이지가 되므로, 다른 섹션이라도 끌어와 채운다.
        sections[CONTENT_MARKER] = sections[CLOSING_MARKER] or sections[PROMISE_MARKER] or "방문해주셔서 감사합니다."
    return sections


def _parse_hashtags(raw: str) -> list[str]:
    """'#대구인테리어필름 #주방필름시공' 같은 한 줄을 리스트로 쪼갠다. 모델이 줄바꿈이나
    쉼표로 구분해도(완벽히 지시를 안 지킬 때가 있다) 공백·줄바꿈·쉼표 전부 구분자로
    받아들이고, '#'이 없는 토큰에는 붙여준다 — 빈 결과는 그냥 빈 리스트로 둔다
    (네이버 복사 포맷에서 해시태그 줄 자체를 생략하면 그만이라 에러로 취급 안 함)."""
    tokens = raw.replace(",", " ").replace("\n", " ").split()
    tags = []
    for token in tokens:
        tag = token.strip()
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = f"#{tag}"
        if tag not in tags:
            tags.append(tag)
    return tags[:MAX_HASHTAGS]


def _collect_reference_images(quote: dict) -> list[Image.Image]:
    """전(원본)/작업 중/후 사진을 최대 개수 안에서 고르게 섞어 로드한다.
    원본 1장 + 현장 사진들을 순서대로 채우되, 전체 개수는 API 호출 비용/속도
    때문에 MAX_REFERENCE_PHOTOS로 제한한다."""
    by_stage: dict[str, list[str]] = {"before": [], "progress": [], "after": []}
    for photo in quote.get("work_photos", []):
        by_stage.setdefault(photo.get("stage", "progress"), []).append(_static_url_to_path(photo["url"]))

    ordered: list[str] = []
    original = quote.get("original_image_url")
    if original:
        ordered.append(_static_url_to_path(original))
    ordered += by_stage["before"]
    ordered += by_stage["progress"][:3]
    after_paths = by_stage["after"]
    rendered = quote.get("rendered_image_url")
    if not after_paths and rendered:
        after_paths = [_static_url_to_path(rendered)]
    ordered += after_paths

    images = []
    for path in ordered[:MAX_REFERENCE_PHOTOS]:
        try:
            images.append(Image.open(path))
        except OSError:
            continue
    return images


def _static_url_to_path(url: str) -> str:
    """"/static/uploads/x.jpg" 형태의 공개 URL을 로컬 파일 경로("storage/uploads/x.jpg")로
    되돌린다 (app/pipeline.py의 _to_static_url과 정반대 변환)."""
    return url.replace("/static/", "storage/", 1).lstrip("/")
