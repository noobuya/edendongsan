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
# [2026-11-03 3차 개편 — 일반 독자용 "사진 + 큰 문구" 스타일]
# 사장님 요청: "전문가적인 글보다 일반인이 봤을 때 인테리어가 더 부각되게, 사진과 큰
# 문구로". 네이버 블로그를 최우선 발행처로 두고, 긴 에세이 대신 짧고 강한 "# 큰 문구"
# 줄 + 1~2문장 설명 블록을 반복하는 구조로 바꿨다. 앱 블로그 화면과 네이버 옮기기
# 순서표가 "# " 줄을 큰 글씨로 보여 주고, 블록 사이마다 시공 전/후 비교 사진을 자동으로
# 끼워 넣는다(프론트 lib/blogBlocks.ts). 사실 원칙(사진·실제 자재명만, 가격·전화번호
# 금지, 브랜드 지어내기 금지)은 그대로다.
PROMPT_TEMPLATE = (
    "당신은 인테리어에 관심 많은 일반인도 술술 읽게 만드는, 사진 중심 네이버 인기 블로그 "
    "작가다. 첨부된 시공 전/작업 중/후 사진과 아래 실제 시공 내역을 보고, 읽는 사람이 "
    "'우리 집도 이렇게 바꾸고 싶다'는 생각이 들게 하는 시공 후기를 한국어로 작성하라.\n"
    "시공 항목: {item_names}\n"
    "사용 자재(실제 발주 품번 — 언급한다면 반드시 이 명칭 그대로, 다른 브랜드를 지어내지 마라): "
    "{material_names}\n"
    "지역: {service_area}\n"
    "이 업체가 모든 현장에서 지키는 실제 표준 공정(쉬운 말로 한 블록에 녹일 것): {standard_process}\n"
    "요구사항:\n"
    "- 전문 용어는 최소로, 친근하고 쉬운 '~요' 체로 쓴다. 이모지는 블록마다 0~1개 정도만 "
    "자연스럽게 써도 된다(과하게 도배하지 않는다).\n"
    "- 사진에 실제로 보이는 변화(색, 분위기, 밝기, 깔끔함)를 근거로 쓰고, 주어지지 않은 내용"
    "(존재하지 않는 브랜드, 자격증, 수상 이력, 옵션)은 절대 지어내지 마라.\n"
    "- 견적/비용 금액은 절대 적지 마라. 전화번호와 출장 지역 문구도 적지 마라(글 끝에 고정 "
    "문구로 자동으로 붙는다).\n"
    "- 제목은 '[{service_area_short} 인테리어 필름]'으로 시작하고, 일반인이 클릭하고 싶어지는 "
    "짧고 강한 문장으로 쓴다(예: '[대구 인테리어 필름] 20년 된 주방, 필름 하나로 새집처럼'). "
    "고객 이름은 넣지 않는다.\n"
    "- '본문'은 4~6개의 블록으로 쓴다. 각 블록은 반드시 '# '로 시작하는 큰 문구 한 줄(15자 "
    "안팎, 짧고 강렬하게 — 예: '# 문을 열자마자 와! 소리가 나요')로 시작하고, 그 아래 줄에 "
    "1~2문장(각 문장은 짧게)의 설명을 붙인다. 블록과 블록 사이는 빈 줄 하나로 띄운다. 블록 "
    "사이에는 시공 전/후 비교 사진이 자동으로 들어가니, 블록 순서를 '처음 모습(고민) → 바뀐 "
    "모습 → 디테일 → 생활이 달라진 점' 흐름으로 써서 사진과 자연스럽게 이어지게 한다. 표준 "
    "공정은 '# 안 보이는 곳까지 꼼꼼하게' 같은 블록 하나에 쉬운 말로 담는다. 함께 작업한 우리 "
    "팀에 대한 고마움은 넣고 싶으면 한 문장 정도로 짧게만 쓴다. 강조할 단어는 **굵게**(앞뒤 "
    "** ) 표시할 수 있다.\n"
    "- '약속' 항목은 이 업체의 원칙 2~3개를 각 줄 '- '로 시작해 한 줄씩 짧게 적는다(검증 "
    "불가능한 자격증·수상 이력 금지).\n"
    "- '마무리' 항목은 2~3문장으로, 바뀐 공간에 대한 설렘과 '1년 무상 A/S'를 언급하고 "
    "'사진 한 장만 보내 주시면 편하게 상담해 드려요' 같은 쉬운 상담 안내로 끝낸다.\n"
    "- '팁' 항목은 '필름 시공 업체 고를 때 체크할 3가지'를 번호(1. 2. 3.)로 한 줄씩 짧게 "
    "적는다(일반적인 조언 수준, 경쟁사 비방 금지).\n"
    "- 과장 광고 문구(예: '국내 1위', '평생 보장')는 쓰지 않는다.\n"
    "- '해시태그' 항목은 네이버 검색에 쓸 해시태그 8~10개(지역명·시공 항목·'인테리어필름'·"
    "'셀프인테리어' 같은 실제 검색어 위주)를 '#'로 시작해 한 줄에 공백으로 나열한다.\n"
    "- 다른 설명 없이 정확히 이 형식으로만 답하라(아래 여섯 마커를 그대로, 이 순서대로):\n"
    f"{TITLE_MARKER} (블로그 제목 한 줄)\n"
    f"{CONTENT_MARKER}\n(# 큰 문구 + 짧은 설명 블록 4~6개)\n"
    f"{PROMISE_MARKER}\n(약속 2~3줄)\n"
    f"{CLOSING_MARKER}\n(설렘 + A/S + 상담 안내 2~3문장)\n"
    f"{TIPS_MARKER}\n(체크할 3가지)\n"
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
        blocks.append(f"# {BUSINESS_NAME}의 약속\n{promise}")

    closing = sections[CLOSING_MARKER]
    if closing:
        blocks.append(closing)

    tips = sections[TIPS_MARKER]
    if tips:
        blocks.append(f"# 업체 고를 때 꼭 체크하세요\n{tips}")

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
