"""Gemini 네이티브 이미지 편집 모델로 "시공 후" 사진을 한 번에 만들어낸다.

왜 기존 방식(부위별 리컬러 + 마스크 인페인팅)을 대체하는가 —
지금까지는 (1) SAM이 찾은 문짝 마스크마다 LAB 리컬러로 색만 갈아끼우고,
(2) 천장 조명/실링팬만 따로 Replicate 인페인팅으로 그려 넣는 "부분 수정" 방식을
썼다. 색은 정확히 반영되지만 결과가 "원본 사진에 색만 덧칠한 것"에 가까워,
바닥/상판/타일/조명이 그대로 남아 실제 리모델링 후 사진처럼 보이지 않았다.

Gemini의 이미지 편집 모델(gemini-3.1-flash-image 등)은 사진 한 장과 지시문만으로
카메라 각도·방 구조·창문 위치를 유지한 채 마감재 전체를 일관되게 바꿔준다.
실제로 같은 주방 사진으로 비교해보니, 이 방식만 사장님이 원하던 "완전히
시공을 마치고 다시 찍은 사진" 수준의 결과가 나왔다. 그래서 초기 시뮬레이션은
이 모델을 1순위로 쓰고, 실패하면 기존 부분 수정 파이프라인으로 폴백한다.

주의: 이 모델은 생성형이라 호출마다 결과가 조금씩 달라지고, 아주 가끔 원본에
없던 요소를 만들어낼 수 있다. 그래서 프롬프트에서 "구조/각도/창문/좌측 목재
가구는 그대로 유지", "사진 안에 글자나 워터마크를 넣지 말 것"을 명시한다.
"""
from google import genai
from google.genai import errors as genai_errors
from PIL import Image

from app.config import get_settings
from app.services.timeouts import run_gemini_with_retry

# 실측 비교 결과 3.1이 실링팬/다운라이트까지 요청대로 정확히 그려냈다.
# 앞의 모델이 실패하면 다음 후보로 순서대로 시도한다.
IMAGE_MODELS = ("gemini-3.1-flash-image", "gemini-2.5-flash-image")
SCENE_TIMEOUT_S = 90
SCENE_MAX_RETRIES = 2
SCENE_RETRY_WAIT_S = 5.0

BASE_INSTRUCTION = (
    "Edit this interior photo to show the room exactly as it looks after the renovation "
    "described below. Keep the same camera angle, perspective, room layout, wall positions, "
    "window position and ceiling height. Do not add, remove or move any furniture that is not "
    "mentioned. Do not write any text, label, watermark or logo anywhere in the image. "
    "The result must look like a real photograph taken after the work was finished: "
    "photorealistic, natural lighting consistent with the original photo, "
    "professional real-estate interior photography quality.\n\nRenovation work performed:\n"
)


def render_scene(image_path: str, work_instructions: list[str]) -> bytes:
    """원본 사진 + 시공 지시문으로 "시공 후" 이미지를 생성해 PNG/JPEG 바이트로 돌려준다."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("Gemini API 키가 설정되어 있지 않습니다.")
    if not work_instructions:
        raise RuntimeError("시공 지시문이 비어 있습니다.")

    prompt = BASE_INSTRUCTION + "\n".join(f"- {line}" for line in work_instructions)
    client = genai.Client(api_key=settings.gemini_api_key)
    source = Image.open(image_path)

    last_error: Exception | None = None
    for model in IMAGE_MODELS:
        try:
            response = run_gemini_with_retry(
                client.models.generate_content,
                SCENE_TIMEOUT_S,
                model=model,
                contents=[prompt, source],
                max_retries=SCENE_MAX_RETRIES,
                retry_wait_s=SCENE_RETRY_WAIT_S,
                retry_on_timeout=True,
            )
            image_bytes = _extract_image(response)
            if image_bytes:
                return image_bytes
            last_error = RuntimeError(f"{model}이 이미지를 반환하지 않았습니다.")
        except (genai_errors.APIError, TimeoutError) as exc:
            last_error = exc
            continue

    raise RuntimeError(f"시공 후 이미지 생성에 실패했습니다: {last_error}")


def _extract_image(response) -> bytes | None:
    """응답 파트 중 이미지 데이터를 찾아 돌려준다 (텍스트 파트가 섞여 올 수 있다)."""
    for candidate in response.candidates or []:
        for part in (candidate.content.parts if candidate.content else []) or []:
            inline = getattr(part, "inline_data", None)
            if inline is not None and inline.data:
                return inline.data
    return None
