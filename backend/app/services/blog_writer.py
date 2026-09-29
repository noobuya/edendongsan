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

from app.business_info import BUSINESS_NAME, BUSINESS_PHONE, BUSINESS_SERVICE_AREA
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
SECTION_MARKERS = [TITLE_MARKER, CONTENT_MARKER, PROMISE_MARKER, CLOSING_MARKER, TIPS_MARKER]

# response_mime_type="application/json"(구조화 출력)은 쓰지 않는다 — 실측 결과
# 이 계정/시점에서 "이미지 첨부 + JSON 모드"를 함께 쓸 때 503(UNAVAILABLE, 과부하)
# 비율이 유독 높았다(반복 호출 시 약 90% 실패, 같은 요청에서 JSON 모드만 뺐더니
# 실패율이 크게 낮아짐). 대신 마커로 구분한 일반 텍스트를 받아 직접 파싱한다 —
# 형식이 살짝 어긋나도 _parse_response()가 방어적으로 처리한다.
#
# 섹션을 5개로 나눈 이유: 실제 인테리어 시공 후기 블로그들(네이버 상위 노출
# 글 다수)을 참고하면 "인사말/전문가가 필요한 이유" -> "업체의 약속(강조 포인트)"
# -> "마무리 인사" -> "전문업체 고를 때 체크할 점" 구조가 공통적으로 쓰인다.
# 이 구조를 그대로 채택하되, 내용은 항상 사진에 근거하거나 일반적인 조언 수준으로
# 제한해 특정 자재 브랜드·수상 이력 같은 검증 불가능한 사실은 지어내지 않는다.
PROMPT_TEMPLATE = (
    "너는 인테리어 시공 업체의 블로그 마케팅 담당자다. 첨부된 시공 전/작업 중/후 사진을 "
    "참고해 '{customer_name}' 고객 현장의 시공 후기 블로그 글을 한국어로 작성하라.\n"
    "시공 항목: {item_names}\n"
    "지역: {service_area}\n"
    "요구사항:\n"
    "- 실제로 사진에 보이는 내용(색상, 부위, 분위기 변화)을 근거로 서술하고, 사진에 없는 "
    "내용(예: 특정 브랜드, 자격증, 수상 이력, 존재하지 않는 옵션)은 절대 지어내지 마라.\n"
    "- 견적/시공 비용 금액은 어떤 항목에도 절대 적지 마라 — 공개 블로그 글에는 가격을 노출하지 "
    "않는다(비용 문의는 전화 상담으로 유도한다).\n"
    "- 제목은 지역과 시공 항목이 자연스럽게 들어가게 짓는다(예: '대구 OO동 주방 필름 시공 "
    "후기'처럼 지역+공간+시공 항목 조합). 고객 이름은 제목에 넣지 않는다. 제목 맨 앞에 시공 "
    "항목/분위기와 어울리는 이모지 1개를 붙인다(예: '🏠', '✨', '🛠️').\n"
    "- 본문 첫 문단은 '안녕하세요, {business_name}입니다.'로 가볍게 인사하며 시작하고, "
    "이어서 이런 작업은 왜 경험 있는 전문가에게 맡기는 게 좋은지 짧게 설명한 뒤, 시공 전 "
    "상태와 작업 과정을 2~3문단으로 서술한다. 마크다운 문법(#, * 등)은 쓰지 마라.\n"
    "- 글이 눈에 잘 들어오도록, 문단마다 핵심 문장 앞뒤에 어울리는 이모지를 1~2개씩 자연스럽게 "
    "넣는다(예: 😊, ✨, 👍, 🏠, 🎨). 다만 한 문장에 이모지를 3개 이상 몰아넣거나 억지로 "
    "끼워 넣지는 마라 — 과하면 오히려 신뢰가 떨어진다.\n"
    "- '약속' 항목은 이 업체가 지키는 원칙을 2~3개, 각 줄을 '✅ '로 시작해서 적는다(예: "
    "꼼꼼한 마무리, 시공 전 원인 파악 후 작업 등 — 검증 불가능한 특정 브랜드/자격증 언급 금지).\n"
    "- '마무리' 항목은 완성 후 결과/분위기 변화에 대한 소감과 감사 인사를 1~2문단으로 적는다.\n"
    "- '팁' 항목은 '전문업체를 고를 때 확인하면 좋은 점 3가지'를 번호(1. 2. 3.)를 붙여 "
    "한 줄씩 적는다 — 일반적으로 통용되는 조언 수준으로 쓰고 특정 경쟁사를 비방하지 않는다.\n"
    "- 과장된 허위 광고 문구(예: '국내 1위', '평생 보장') 없이, 담백하고 신뢰가 가는 톤으로 쓴다.\n"
    "- 어떤 항목에도 전화번호나 출장 가능 지역 문구를 그대로 적지 마라 — 그 정보는 글 앞뒤에 "
    "고정된 배너/문구로 자동으로 붙으므로, 잘못된 번호를 지어낼 위험이 있다. (업체명은 인사말에서만 "
    "한 번 언급한다.)\n"
    "- 다른 설명 없이 정확히 이 형식으로만 답하라(아래 다섯 줄의 마커를 그대로, 이 순서대로 포함할 것):\n"
    f"{TITLE_MARKER} (블로그 제목 한 줄)\n"
    f"{CONTENT_MARKER}\n(인사말+전문가 필요성+시공 전 상태+작업 과정)\n"
    f"{PROMISE_MARKER}\n(약속 2~3줄)\n"
    f"{CLOSING_MARKER}\n(마무리 소감 1~2문단)\n"
    f"{TIPS_MARKER}\n(전문업체 체크포인트 3줄)"
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

    prompt = PROMPT_TEMPLATE.format(
        customer_name=quote.get("customer_name") or "고객님",
        item_names=", ".join(item_names) or "인테리어 시공",
        service_area=BUSINESS_SERVICE_AREA,
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
    return {"title": title, "content": content, "created_at": datetime.now(timezone.utc).isoformat()}


def _signature_block() -> str:
    """전화번호/상호명은 LLM이 지어내면 안 되는 값이라, 본문과 별개로 여기서
    고정 문구를 붙인다. 프론트엔드가 본문을 빈 줄(\\n\\n) 기준으로 문단을 나눠
    렌더링하므로, 이 블록도 독립된 문단으로 보이도록 앞에 빈 줄을 하나 둔다."""
    return f"📞 문의: {BUSINESS_NAME} {BUSINESS_PHONE}\n📍 {BUSINESS_SERVICE_AREA}"


def _assemble_content(sections: dict[str, str]) -> str:
    """5개 섹션을 실제 시공 후기 블로그에서 흔한 순서(본문 -> 약속 -> 마무리 -> 팁 ->
    문의 배너)로 조립한다. 약속/팁은 불릿·번호가 붙은 목록이라 소제목을 앞에 붙여
    한눈에 섹션이 구분되게 한다."""
    blocks = [sections[CONTENT_MARKER]]

    promise = sections[PROMISE_MARKER]
    if promise:
        blocks.append(f"✨ {BUSINESS_NAME}의 약속\n{promise}")

    closing = sections[CLOSING_MARKER]
    if closing:
        blocks.append(closing)

    tips = sections[TIPS_MARKER]
    if tips:
        blocks.append(f"💡 전문업체를 고를 때 확인하면 좋은 점\n{tips}")

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
