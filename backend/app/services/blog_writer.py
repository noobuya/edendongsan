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

from app import business_info
from app.business_info import BUSINESS_CORE_HASHTAGS
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
# BUSINESS_CORE_HASHTAGS(고정 지역·서비스 키워드)가 항상 먼저 들어가고, 그 뒤에
# 이 글 내용에 맞는 AI 생성 태그가 이어 붙는다 — 전체 상한을 고정 태그 개수보다
# 넉넉히 키워, 고정 태그가 AI 태그를 밀어내지 않게 한다.
MAX_HASHTAGS = len(BUSINESS_CORE_HASHTAGS) + 7

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
# 줄 + 1~2문장 설명 블록을 반복하는 구조로 바꿨다.
#
# [2026-11-27 4차 개편 — 논리 전개형 "직영 구조" 에세이로 전환]
# 사장님이 실제로 발행한 글(블로그 링크로 직접 읽혀 줌: "화려한 쇼룸도, 영업사원도
# 없앴습니다...")을 보여주며 "앞으로 이거와 똑같은 생각과 추구 사상과 글체로 만들어
# 달라"고 명시적으로 요청했다. 그 글을 분석해 보면 3차 개편의 "짧은 문구+사진" 방식과는
# 결이 다르다 — 공감형 질문으로 문을 열고, 소제목(섹션) 아래 3~6문장으로 논리를 충분히
# 전개하며, 이 업체만의 철학(아래 BUSINESS_PHILOSOPHY_NOTE)을 매번 자기 말로 풀어 설득한다.
# 제목도 "[지역 인테리어필름]" 같은 기계적 접두사 없이 호기심/반전을 직접 건드린다.
# 블록 파싱 프로토콜(TITLE/CONTENT/PROMISE/CLOSING/TIPS/HASHTAG 여섯 마커,
# "# 소제목" 문단 구분)은 그대로 둬서 frontend/lib/blogBlocks.ts의 사진 끼워 넣기와
# 네이버 옮기기 순서표를 그대로 재사용한다 — 바뀐 건 마커 안에 요구하는 내용과 분량,
# 문체뿐이다.
BUSINESS_PHILOSOPHY_NOTE = (
    "① 아직 멀쩡한 가구·구조물을 부수고 새로 사는 건 불필요한 비용과 폐기물만 키우는 "
    "과잉 시공이라 보고, 겉면 마감만 정교하게 되살리는 방식을 고집한다. "
    "② 화려한 오프라인 쇼룸, 영업사원 인센티브, 중간 하청 마진을 없앤 직영 구조라서 "
    "같은 자재·같은 정석 공정을 쓰고도 더 정직한 가격을 제안할 수 있다. "
    "③ 쇼룸 조명 아래서 고른 색은 집에 붙이면 다르게 보이므로, 필름 샘플북과 장비를 "
    "직접 싣고 고객의 공간으로 찾아가 실제 조명·벽지·바닥재에 맞춰 1:1 컬러 매칭하고, "
    "밑작업 범위까지 눈으로 실측해 시공 당일 추가 비용이 생기지 않게 한다. "
    "④ 낮에는 바빠서 연락하기 어려운 고객을 배려해 상담 시간을 넉넉히 열어 두고, "
    "시공 후 1년 무상 A/S로 끝까지 책임진다."
)
PROMPT_TEMPLATE = (
    "당신은 '직영 구조로 거품을 뺀 정직한 인테리어 필름 시공'이라는 철학을 가진 업체의 "
    "마케팅 담당자다. 아래는 이 업체가 모든 글에서 진짜로 믿고 실천하는 원칙이다 — 글마다 "
    "이 중 해당되는 내용을 자기 말로 풀어서 녹여야 한다(통째로 베끼지 말 것):\n"
    f"{BUSINESS_PHILOSOPHY_NOTE}\n\n"
    "첨부된 시공 전/작업 중/후 사진과 아래 실제 시공 내역을 바탕으로, 고객이 끝까지 읽고 "
    "'이 업체라면 믿을 수 있겠다'는 확신이 들게 하는 논리 전개형 글을 한국어로 작성하라. "
    "짧은 문구를 사진 사이사이 끼워 넣는 식이 아니라, 고민 → 구조적 이유 → 구체적 범위 → "
    "신뢰 장치 순서로 차근차근 설득하는 글이어야 한다.\n"
    "시공 항목: {item_names}\n"
    "사용 자재(실제 발주 품번 — 언급한다면 반드시 이 명칭 그대로, 다른 브랜드를 지어내지 마라): "
    "{material_names}\n"
    "지역: {service_area}\n"
    "표준 공정(쉬운 말로 '시공 범위' 섹션 안에 자연스럽게 녹일 것): {standard_process}\n"
    "요구사항:\n"
    "- 문체: 친근한 '~습니다/~요' 존댓말. 이모지는 쓰지 않는다. 문장이 끝나면 줄을 바꿔 "
    "짧게짧게 읽히게 쓴다(한 줄이 두 문장을 넘지 않게) — 네이버 블로그 특유의 리듬이다.\n"
    "- 공감형 질문으로 문을 연다(예: '~받아보고 한숨부터 나오신 적 있으신가요?', '~라고 "
    "물으시는 분들이 계십니다') — 고객이 실제로 겪는 불안(비싼 견적에 놀람, 혹은 저렴한 "
    "곳의 당일 추가비용 통보)을 먼저 짚고 시작한다.\n"
    "- 사진에 실제로 보이는 변화(색, 분위기, 밝기, 깔끔함)를 근거로 쓰고, 주어지지 않은 "
    "내용(존재하지 않는 브랜드, 자격증, 수상 이력, 옵션)은 절대 지어내지 마라.\n"
    "- 견적/비용 금액은 절대 적지 마라(단, '통교체 대비 합리적' 같은 상대적 비교 표현은 "
    "가능하다). 전화번호와 출장 지역 문구도 본문에 적지 마라(글 끝에 고정 문구로 자동으로 "
    "붙는다).\n"
    "- 제목은 지역명을 넣는 기계적인 형식이 아니라, 고객의 불안이나 반전을 직접 건드리는 "
    "임팩트 있는 한 문장으로 쓴다(참고 예시: '화려한 쇼룸도, 영업사원도 없앴습니다. 거품 "
    "싹 뺀 \"직영 견적\"과 \"24시 현장 상담\"만 남긴 이유'). 고객 이름은 넣지 않는다.\n"
    "- '본문'은 먼저 소제목 없는 오프닝 문단 1개(공감형 질문)로 시작하고, 이어서 '# '로 "
    "시작하는 소제목 섹션을 3~4개 쓴다. 소제목은 15~25자 안팎으로 그 섹션의 핵심 주장을 "
    "담은 문장이어야 한다(예: '# 견적 거품이 싹 빠지는 두 가지 이유'). 소제목 아래는 "
    "3~6문장으로 충분히 풀어 설명한다(1~2문장짜리 짧은 블록 금지). 섹션 구성은 아래 "
    "흐름을 참고해 이번 시공 내용에 맞게 재구성한다: "
    "① 왜 거품이 빠지는지(위 원칙 ①②를 이번 시공에 맞게 풀어서) "
    "② 실제로 시공한 범위와 꼼꼼함(표준 공정을 이 섹션에 녹인다) "
    "③ 자재·색상을 고른 과정(원칙 ③ — 쇼룸이 아니라 현장에서 실측·매칭했다는 신뢰 장치) "
    "④ 상담·보증 체계(원칙 ④). 섹션과 섹션 사이에는 시공 전/후 비교 사진이 자동으로 "
    "들어가므로 사진과 자연스럽게 이어지는 순서로 배치한다. 설명 문장 중 핵심 단어 1개는 "
    "**단어**(별표 두 개, 주황색 볼드로 바뀜)로, 가장 눈에 띄었으면 하는 짧은 문구(5~10자 "
    "안팎) 1개는 ==문구==(등호 두 개, 노란 하이라이트로 바뀜)로 섹션마다 1곳씩만 감싼다.\n"
    "- '약속' 항목은 위 원칙을 이번 시공에 맞춰 2~3줄로 짧게 재확인한다(각 줄 '- '로 "
    "시작, 검증 불가능한 자격증·수상 이력 금지).\n"
    "- '마무리' 항목은 2~3문장으로, 바뀐 공간에 대한 설렘과 '1년 무상 A/S'를 언급하고 "
    "'퇴근 후 늦은 밤이라도 시공 원하시는 부위 사진과 대략적인 사이즈를 보내 주시면 "
    "편하게 진단해 드려요' 같은 부담 없는 상담 안내로 끝낸다.\n"
    "- '팁' 항목은 '시공 업체 고를 때 반드시 확인해야 할 3가지'를 번호(1. 2. 3.)로 한 줄씩 "
    "짧게 적는다(위 원칙과 이어지는 내용, 경쟁사 비방 금지).\n"
    "- 과장 광고 문구(예: '국내 1위', '평생 보장')는 쓰지 않는다.\n"
    "- '해시태그' 항목은 네이버 검색에 쓸 해시태그 5~7개를 '#'로 시작해 한 줄에 공백으로 "
    "나열한다. 지역명·'인테리어필름'·'셀프인테리어' 같은 일반 검색어는 이미 고정으로 "
    "붙으니 반복하지 말고, 이번 시공 항목·자재·공간(예: #욕실리모델링, #방화문필름, "
    "#조명교체)처럼 이 글에만 해당하는 구체적인 태그 위주로 채운다.\n"
    "- 다른 설명 없이 정확히 이 형식으로만 답하라(아래 여섯 마커를 그대로, 이 순서대로):\n"
    f"{TITLE_MARKER} (블로그 제목 한 줄)\n"
    f"{CONTENT_MARKER}\n(오프닝 문단 1개 + # 소제목 섹션 3~4개, 섹션마다 3~6문장)\n"
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
        item_names=", ".join(item_names) or (quote.get("blog_memo") or "").strip() or "인테리어 필름 시공",
        material_names=material_names,
        service_area=business_info.service_area(),
        service_area_short=business_info.service_area_short(),
        standard_process=STANDARD_PROCESS_NOTE,
        business_name=business_info.business_name(),
    )

    # 사진·제목만으로 만드는 블로그(routers/blog_compose.py): 사장님이 정한 제목은 바꾸지
    # 않고, 한 줄 메모(시공 내용)는 견적 내역 대신 사실 근거로 쓴다.
    title_override = (quote.get("blog_title") or "").strip()
    memo = (quote.get("blog_memo") or "").strip()
    if memo:
        prompt += f"\n- 사장님이 적은 시공 메모(사실로 취급해 본문에 반영할 것): {memo}"
    if title_override:
        prompt += (
            f"\n- 제목은 사장님이 정한 '{title_override}'를 그대로 쓴다(제목 줄에 이 문장을 그대로 적고, "
            "본문은 이 제목에 어울리게 새로 쓴다)."
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
    title = title_override or sections[TITLE_MARKER] or "시공 후기"
    content = _assemble_content(sections)
    hashtags = _merge_hashtags(_parse_hashtags(sections[HASHTAG_MARKER]))
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
    return f"문의: {business_info.business_name()} {business_info.business_phone()}\n{business_info.service_area()}"


def _assemble_content(sections: dict[str, str]) -> str:
    """5개 섹션을 실제 시공 후기 블로그에서 흔한 순서(본문 -> 약속 -> 마무리 -> 팁 ->
    문의 배너)로 조립한다. 약속/팁은 불릿·번호가 붙은 목록이라 소제목을 앞에 붙여
    한눈에 섹션이 구분되게 한다(이모지 없는 소제목 — 위 _signature_block 참고)."""
    blocks = [sections[CONTENT_MARKER]]

    promise = sections[PROMISE_MARKER]
    if promise:
        blocks.append(f"# {business_info.business_name()}의 약속\n{promise}")

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


def _merge_hashtags(ai_tags: list[str]) -> list[str]:
    """고정 지역·서비스 키워드(BUSINESS_CORE_HASHTAGS)를 맨 앞에 무조건 넣고, 이 글
    내용에 맞춰 AI가 만든 태그를 중복 없이 이어 붙인다 — 전화번호처럼 AI가 빠뜨리면
    안 되는 값은 AI 출력을 신뢰하지 않고 고정값으로 강제하는 것과 같은 원칙이다."""
    merged = list(BUSINESS_CORE_HASHTAGS)
    for tag in ai_tags:
        if tag not in merged:
            merged.append(tag)
    return merged[:MAX_HASHTAGS]


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
