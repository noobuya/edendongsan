"""AI 제안서(고객 발송용 상세페이지)의 이미지·카피 생성.

blog_writer.py(시공 후기 블로그 글)와 vision_client.py(Gemini Vision으로 구조화된
JSON 받기)의 패턴을 그대로 따른다 — 다만 목적이 다르다: 블로그는 SEO용 장문
후기이고, 이건 고객 1명에게 바로 보내는 짧은 영업 카피 + 디테일 크롭 이미지다.

[디테일 크롭이 실패해도 파이프라인은 항상 끝까지 간다]
Gemini Vision이 크롭 좌표를 못 주거나(크레딧 소진·일시 과부하) 이상한 값을 주면,
원본 사진 중앙을 잘라내는 결정적(deterministic) 폴백으로 대신한다 —
segmentation.py가 분류 실패 시 휴리스틱으로 폴백하는 것과 같은 원칙이다.
"""
import json
import uuid
from pathlib import Path

from google import genai
from google.genai import errors as genai_errors, types
from PIL import Image, ImageEnhance

from app.business_info import BUSINESS_NAME
from app.config import get_settings
from app.services.timeouts import run_gemini_with_retry

GEMINI_MODEL = "gemini-flash-latest"
VISION_TIMEOUT_S = 30
COPY_TIMEOUT_S = 30
COPY_MAX_RETRIES = 3
COPY_RETRY_WAIT_S = 5.0
COPY_BACKOFF_FACTOR = 2.0

DETAIL_CROP_PROMPT = (
    "이 인테리어 시공 사진에서 필름/마감재의 질감과 결(그레인)이 가장 또렷하게 보이는 "
    "직사각형 영역 하나를 골라라. 사람 얼굴, 빈 벽, 잘린 가구는 피하고 문짝·몰딩·마감면의 "
    "표면이 화면을 가득 채우는 구도를 골라라. 좌표는 원본 이미지의 0~1 사이 비율로, "
    "다음 JSON 형식으로만 답하라: "
    '{"left": number, "top": number, "right": number, "bottom": number}'
)

# 디테일 컷은 전체 구도가 아니라 "확대해서 질감을 보여주는" 용도라 원본의 15~45%
# 크기 범위를 벗어나면 와이드컷과 구분이 안 되거나(너무 큼) 뭘 보여주는지 알아볼
# 수 없다(너무 작음). Gemini가 범위 밖 값을 주면 이 한도로 눌러준다.
MIN_CROP_RATIO = 0.15
MAX_CROP_RATIO = 0.45

COPY_PROMPT_TEMPLATE = (
    "너는 인테리어 필름 시공 업체의 영업 담당자다. 첨부된 시공 사진을 보고, 고객에게 "
    "문자·카카오톡으로 바로 보낼 '{business_name}'의 짧은 영업 제안서 문구를 한국어로 써라.\n"
    "{context_line}"
    "요구사항:\n"
    "- 사진에 실제로 보이는 내용(색상·마감·분위기)만 근거로 쓰고, 보이지 않는 브랜드명·"
    "자격증·수상 이력을 지어내지 마라.\n"
    "- 헤드라인은 한 줄, 20자 안팎으로 임팩트 있게(예: '무광 화이트로 완성한 주방').\n"
    "- 본문은 2~3문장, 합쳐서 120자 안팎으로 짧게 — 길게 설명하지 말고 바로 연락하고 "
    "싶게 만드는 톤으로 쓴다. 과장 광고 문구('국내 1위' 등)는 쓰지 마라.\n"
    "- 가격 금액을 구체적으로 지어내지 마라(아래 비교 문구가 주어지면 그 문장만 그대로 "
    "자연스럽게 본문에 녹여라).\n"
    "- 다른 설명 없이 정확히 이 형식으로만 답하라:\n"
    "헤드라인: (한 줄)\n본문: (2~3문장)"
)


def _to_static_url(storage_path: str) -> str:
    return "/" + storage_path.replace("storage/", "static/", 1)


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _fallback_crop_box(image: Image.Image) -> tuple[int, int, int, int]:
    """Gemini를 못 쓰거나 실패했을 때 — 중앙을 원본의 30% 크기로 잘라낸다.
    문손잡이·경첩 같은 디테일이 보통 화면 중앙~하단에 있어 완전히 엉뚱한 자리가
    잘려 나가는 경우는 드물다."""
    w, h = image.size
    ratio = 0.3
    cw, ch = int(w * ratio), int(h * ratio)
    left = (w - cw) // 2
    top = (h - ch) // 2
    return left, top, left + cw, top + ch


def _ask_gemini_crop_box(image: Image.Image, api_key: str) -> tuple[int, int, int, int] | None:
    try:
        client = genai.Client(api_key=api_key)
        response = run_gemini_with_retry(
            client.models.generate_content,
            VISION_TIMEOUT_S,
            model=GEMINI_MODEL,
            contents=[DETAIL_CROP_PROMPT, image],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        box = json.loads(response.text)
        left, top, right, bottom = (
            _clamp01(float(box["left"])),
            _clamp01(float(box["top"])),
            _clamp01(float(box["right"])),
            _clamp01(float(box["bottom"])),
        )
        if right <= left or bottom <= top:
            return None
        w, h = image.size
        return int(left * w), int(top * h), int(right * w), int(bottom * h)
    except Exception:  # noqa: BLE001 - 실패하면 폴백을 쓴다, 파이프라인을 끊지 않는다
        return None


def _normalize_crop_size(box: tuple[int, int, int, int], image: Image.Image) -> tuple[int, int, int, int]:
    """크롭 영역이 너무 크거나(와이드컷과 구분 안 됨) 너무 작으면(뭘 보여주는지 모름)
    중심을 유지한 채 MIN~MAX 비율 범위로 되돌린다."""
    w, h = image.size
    left, top, right, bottom = box
    cw, ch = right - left, bottom - top
    cx, cy = left + cw / 2, top + ch / 2
    ratio = max(cw / w, ch / h) if w and h else 0
    if MIN_CROP_RATIO <= ratio <= MAX_CROP_RATIO:
        return box
    target_ratio = min(MAX_CROP_RATIO, max(MIN_CROP_RATIO, ratio or MIN_CROP_RATIO))
    nw, nh = w * target_ratio, h * target_ratio
    left = int(max(0, min(w - nw, cx - nw / 2)))
    top = int(max(0, min(h - nh, cy - nh / 2)))
    return left, top, int(left + nw), int(top + nh)


def generate_crops(source_path: str, proposal_id: str) -> dict:
    """와이드컷(원본 그대로)과 디테일컷(크롭)을 만들어 저장하고 정적 URL을 돌려준다."""
    settings = get_settings()
    with Image.open(source_path) as img:
        image = img.convert("RGB")

        box = None
        if settings.gemini_api_key:
            box = _ask_gemini_crop_box(image, settings.gemini_api_key)
        if box is None:
            box = _fallback_crop_box(image)
        box = _normalize_crop_size(box, image)

        detail = image.crop(box)

        wide_path = f"storage/results/{proposal_id}_wide.jpg"
        detail_path = f"storage/results/{proposal_id}_detail.jpg"
        Path(wide_path).parent.mkdir(parents=True, exist_ok=True)
        image.save(wide_path, "JPEG", quality=92)
        detail.save(detail_path, "JPEG", quality=92)

    return {"wide_image_url": _to_static_url(wide_path), "detail_image_url": _to_static_url(detail_path)}


def adjust_brightness(image_url: str, factor: float, proposal_id: str, target: str) -> str:
    """"더 밝게"/"더 어둡게" 빠른 피드백 — AI를 다시 부르지 않고 PIL로 바로 처리한다
    (비용·대기시간이 없는 조정이라 빠른 액션 버튼으로 노출해도 부담이 없다).

    파일명에 매번 새 짧은 id를 붙인다 — proposal_id만 쓰면 원본 크롭 파일과
    같은 경로를 덮어써서 URL이 안 바뀌고, 프론트가 같은 src를 그대로 들고 있으면
    브라우저 캐시 때문에 밝기가 바뀐 걸 못 보고 옛 이미지를 계속 보여준다."""
    path = image_url.replace("/static/", "storage/", 1).lstrip("/")
    with Image.open(path) as img:
        adjusted = ImageEnhance.Brightness(img.convert("RGB")).enhance(factor)
        out_path = f"storage/results/{proposal_id}_{target}_{uuid.uuid4().hex[:8]}.jpg"
        adjusted.save(out_path, "JPEG", quality=92)
    return _to_static_url(out_path)


def _parse_copy(text: str) -> dict:
    headline, body = "", ""
    for line in text.strip().splitlines():
        if line.startswith("헤드라인:"):
            headline = line.split(":", 1)[1].strip()
        elif line.startswith("본문:"):
            body = line.split(":", 1)[1].strip()
        elif body:
            body += " " + line.strip()
    return {"headline": headline or "프리미엄 인테리어 필름 시공", "body": body or "자세한 내용은 문의 주세요."}


def generate_copy(image_path: str, sales_pitch: str = "") -> dict:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("Gemini API 키가 설정되어 있지 않습니다.")

    context_line = f"참고 문구(있으면 자연스럽게 녹여라): {sales_pitch}\n" if sales_pitch else ""
    prompt = COPY_PROMPT_TEMPLATE.format(business_name=BUSINESS_NAME, context_line=context_line)

    with Image.open(image_path) as img:
        image = img.convert("RGB")
        client = genai.Client(api_key=settings.gemini_api_key)
        try:
            response = run_gemini_with_retry(
                client.models.generate_content,
                COPY_TIMEOUT_S,
                model=GEMINI_MODEL,
                contents=[prompt, image],
                max_retries=COPY_MAX_RETRIES,
                retry_wait_s=COPY_RETRY_WAIT_S,
                backoff_factor=COPY_BACKOFF_FACTOR,
                retry_on_timeout=True,
            )
        except genai_errors.APIError as exc:
            if exc.code == 503:
                raise RuntimeError("Gemini가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.") from exc
            raise

    return _parse_copy(response.text)


def regenerate_copy(current: dict, feedback: str) -> dict:
    """기공의 자연어 피드백("텍스트 더 짧게" 등)을 반영해 카피만 다시 쓴다."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("Gemini API 키가 설정되어 있지 않습니다.")

    prompt = (
        "아래는 인테리어 시공 제안서 카피 초안이다. 사용자 피드백을 반영해 다시 써라. "
        "형식은 그대로 유지하고 다른 설명 없이 정확히 이 형식으로만 답하라:\n"
        "헤드라인: (한 줄)\n본문: (2~3문장)\n\n"
        f"기존 헤드라인: {current.get('headline', '')}\n"
        f"기존 본문: {current.get('body', '')}\n"
        f"피드백: {feedback}"
    )
    client = genai.Client(api_key=settings.gemini_api_key)
    response = run_gemini_with_retry(
        client.models.generate_content,
        COPY_TIMEOUT_S,
        model=GEMINI_MODEL,
        contents=[prompt],
        max_retries=COPY_MAX_RETRIES,
        retry_wait_s=COPY_RETRY_WAIT_S,
        backoff_factor=COPY_BACKOFF_FACTOR,
        retry_on_timeout=True,
    )
    return _parse_copy(response.text)
