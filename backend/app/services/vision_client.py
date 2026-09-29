"""Gemini Vision으로 천장 실측 크기를 추정해, 견적서에 "AI 인식 천장 면적"으로
표시할 참고값을 만든다. 정밀 실측이 아니라 참고용 초기값이다.
"""
import json

from google import genai
from google.genai import types
from PIL import Image

from app.config import get_settings
from app.services.timeouts import run_gemini_with_retry

VISION_TIMEOUT_S = 30

# "-latest" 별칭을 사용해 구글이 특정 세대 모델(예: 1.5-flash)을 폐기해도
# 코드 수정 없이 항상 현재 권장되는 플래시 모델을 계속 사용하도록 한다.
GEMINI_MODEL = "gemini-flash-latest"

# Gemini 키가 없거나 호출이 실패했을 때 파이프라인이 끊기지 않도록 쓰는 기본값.
# 실제 서비스에서는 이 값이 노출되면 안 되므로, 반드시 유효한 키를 넣어 대체할 것.
DEFAULT_ROOM_INFO = {
    "ceiling_width_m": 4.0,
    "ceiling_length_m": 3.0,
    "wall_height_m": 2.4,
    "suggested_fan_count": 1,
    "suggested_light_count": 4,
}

PROMPT = (
    "이 실내 사진에서 천장과 벽의 대략적인 실측 크기(미터)를 추정하고, "
    "적절한 실링팬/다운라이트 설치 개수를 아래 JSON 형식으로만 답하라.\n"
    '{"ceiling_width_m": number, "ceiling_length_m": number, '
    '"wall_height_m": number, "suggested_fan_count": number, '
    '"suggested_light_count": number}'
)


def analyze_room(image_path: str) -> dict:
    settings = get_settings()
    if not settings.gemini_api_key:
        return DEFAULT_ROOM_INFO

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        image = Image.open(image_path)

        response = run_gemini_with_retry(
            client.models.generate_content,
            VISION_TIMEOUT_S,
            model=GEMINI_MODEL,
            contents=[PROMPT, image],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        return json.loads(response.text)
    except Exception as exc:
        print(f"[vision_client] Gemini 호출 실패, 기본 치수 사용: {exc}")
        return DEFAULT_ROOM_INFO
