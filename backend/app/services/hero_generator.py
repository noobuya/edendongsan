"""AI로 앱 첫 화면 배경(대표 사진)을 새로 만든다.

[왜 — 2026-11-05 사장님 요청 "상호명·전화번호를 바꾸면 화면 해상도에 맞는
이미지로 AI가 새로 만들어줘"]
지금까지 대표 사진은 사장님이 직접 찍은 사진을 올리는 방식뿐이었다(routers/
brand.py). 이 모듈은 같은 "hero" 자리에, Gemini 이미지 생성 모델로 만든 분위기
있는 배경 위에 현재 상호명·전화번호를 얹은 이미지를 대신 채운다 — 사진이
없어도(또는 마음에 드는 사진이 없어도) 그럴듯한 대표 이미지를 바로 가질 수 있다.

[왜 상호명·전화번호를 AI에게 직접 그리게 하지 않는가]
생성형 이미지 모델은 특히 한글처럼 작은 글자를 정확히 그리는 데 약하다 —
전화번호 숫자 하나만 틀려도 실제로 전화가 안 닿는 사고로 이어진다. 그래서
AI에게는 "글자 없는" 분위기 있는 배경만 맡기고(services/scene_render.py와 같은
Gemini 네이티브 이미지 생성 모델을 쓰되, 원본 사진 없이 프롬프트만으로 만드는
text-to-image 호출), 상호명·전화번호는 blog_thumbnail.py와 같은 방식(PIL로
직접 그리기)으로 정확하게 얹는다 — AI의 장점(분위기)과 정확성이 필요한 부분
(글자)을 각각 가장 잘하는 방법으로 나눠 처리한다."""
from io import BytesIO

from google import genai
from google.genai import errors as genai_errors
from PIL import Image, ImageDraw, ImageOps

from app import business_info
from app.config import get_settings
from app.services.blog_video import _font
from app.services.timeouts import run_gemini_with_retry

IMAGE_MODELS = ("gemini-3.1-flash-image", "gemini-2.5-flash-image")
GEN_TIMEOUT_S = 60
GEN_MAX_RETRIES = 2
GEN_RETRY_WAIT_S = 5.0

# 세로로 길게 꽉 차는 앱 첫 화면 배경(components/BrandHero.tsx)에 맞춘 비율 —
# 요즘 안드로이드 폰의 전형적인 화면 비율(약 20:9)에 가깝게 잡아, 화면을
# 꽉 채우는 object-cover로 어느 기기에 걸어도 크게 잘려나가지 않는다.
W, H = 1080, 2400

PROMPT = (
    "A professional, elegant interior design photograph for a premium home renovation "
    "/ interior film company's mobile app background. Show a beautifully finished modern "
    "Korean apartment living room or kitchen with soft natural lighting, clean lines, warm "
    "neutral tones, tasteful furniture. Portrait orientation, cinematic composition, "
    "photorealistic, high-end real-estate photography quality. Absolutely no text, no "
    "logo, no watermark, no people anywhere in the image — just a clean atmospheric "
    "background photo."
)


def _extract_image(response) -> bytes | None:
    for candidate in response.candidates or []:
        for part in (candidate.content.parts if candidate.content else []) or []:
            inline = getattr(part, "inline_data", None)
            if inline is not None and inline.data:
                return inline.data
    return None


def _generate_background() -> Image.Image:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("Gemini API 키가 설정되어 있지 않습니다.")
    client = genai.Client(api_key=settings.gemini_api_key)

    last_error: Exception | None = None
    for model in IMAGE_MODELS:
        try:
            response = run_gemini_with_retry(
                client.models.generate_content,
                GEN_TIMEOUT_S,
                model=model,
                contents=[PROMPT],
                max_retries=GEN_MAX_RETRIES,
                retry_wait_s=GEN_RETRY_WAIT_S,
                retry_on_timeout=True,
            )
            image_bytes = _extract_image(response)
            if image_bytes:
                return Image.open(BytesIO(image_bytes)).convert("RGB")
            last_error = RuntimeError(f"{model}이 이미지를 반환하지 않았습니다.")
        except (genai_errors.APIError, TimeoutError) as exc:
            last_error = exc
            continue
    raise RuntimeError(f"배경 이미지 생성에 실패했습니다: {last_error}")


def generate_hero_image(out_path: str) -> str:
    """AI가 만든 분위기 있는 배경 위에, 지금 설정된 상호명·전화번호를 정확하게
    그려 넣어 저장한다."""
    bg = _generate_background()
    base = ImageOps.fit(bg, (W, H), Image.LANCZOS)

    # 글자가 항상 읽히도록 아래쪽 40%를 어둡게 깐다(blog_thumbnail.py와 같은 방식).
    gradient = Image.new("L", (1, H))
    for y in range(H):
        t = max(0.0, (y - H * 0.6) / (H * 0.4))
        gradient.putpixel((0, y), int(215 * t))
    gradient = gradient.resize((W, H))
    shade = Image.new("RGB", (W, H), (6, 8, 12))
    base = Image.composite(shade, base, gradient)

    draw = ImageDraw.Draw(base)
    name = business_info.business_name()
    phone = business_info.business_phone()
    margin = 80
    phone_font = _font(58)
    name_font = _font(92)
    phone_y = H - margin - 70
    name_y = phone_y - 118

    draw.text((margin, name_y), name, font=name_font, fill=(255, 255, 255), stroke_width=4, stroke_fill=(0, 0, 0))
    draw.text((margin, phone_y), phone, font=phone_font, fill=(255, 224, 102), stroke_width=3, stroke_fill=(0, 0, 0))

    # [왜 — 2026-11-08 "화면이 늦게 뜬다"] 투명도가 필요 없는 꽉 채우는 배경
    # 사진인데 PNG(무손실)로 저장해 2MB대였다 — JPEG로 같은 화질에서 훨씬
    # 작게(보통 수백 KB) 줄여 로딩을 빠르게 한다.
    base.save(out_path, "JPEG", quality=85, optimize=True)
    return out_path
