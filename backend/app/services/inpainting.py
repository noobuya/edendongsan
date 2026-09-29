"""인페인팅으로 사진 위 특정 부위(SAM-2 마스크)만 극사실적으로 다시 그린다.

처음엔 lucataco/sdxl-inpainting(커뮤니티 SDXL 래퍼)을 썼으나, 실제 호출 결과를
픽셀 단위로 검증해보니 마스크 안쪽과 바깥쪽의 변화량이 거의 같아(약 2.5배 차이에
그침) 색상이 사실상 반영되지 않는 문제가 있었다 — 이 모델은 진짜 "인페인팅
전용" 아키텍처가 아니라 일반 img2img에 마스크를 얹은 형태라, strength를 최대로
줘도 마스크 영역을 충분히 강하게 다시 그리지 못하는 것으로 판단된다.

그래서 stability-ai/stable-diffusion-inpainting(2,100만+ 실행 이력, 마스크 영역을
9채널 인페인팅 전용 U-Net으로 처음부터 다시 그리는 구조 — "흰 픽셀만 다시 그리고
검은 픽셀은 그대로 보존"이라는 마스크 의미가 모델 카드에 명시돼 있어 우리가 이미
쓰던 마스크 형식과 정확히 일치)로 교체했다. SDXL은 아니지만(SD1.5 기반) 실제
마스크 반영 신뢰도가 훨씬 높아, 사용자가 선택한 색상이 실제로 반영되는 것이
"XL"이라는 이름보다 중요하다고 판단했다.

이 모델은 width/height를 명시적으로 받고 64의 배수여야 하므로, 원본 비율을
최대한 유지하면서 두 변 모두 64의 배수로 반올림해 전송한다.

[적용 범위 주의] 여기는 "없던 물건을 새로 그려 넣는" 용도(조명/실링팬 설치,
싱크볼 교체)에만 쓴다. 단순 색상 변경(필름 시공)에는 쓰지 않는다 — 인페인팅은
마스크 안쪽 원본 픽셀을 버리고 노이즈에서 새로 그리는 구조라, 입력 이미지를
미리 원하는 색으로 칠해 보내도 그 정보가 전달되지 않고 모델이 주변 맥락(흰 벽/
흰 상판)에 어울리는 흰 문짝을 다시 그려버린다. 실제로 딥 네이비를 요청한
결과물의 마스크 안쪽 평균색이 (150,145,139)로 거의 무채색이었다. 색상 변경은
rendering.recolor_surface(LAB 명암 보존 리컬러)가 담당한다.
"""
import base64
import io

import httpx
import replicate
from PIL import Image

from app.config import get_settings
from app.services.timeouts import run_replicate_with_retry

INPAINT_MODEL = (
    "stability-ai/stable-diffusion-inpainting:"
    "95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3"
)
MAX_EDGE_PX = 1024
INPAINT_TIMEOUT_S = 120
GUIDANCE_SCALE = 12  # 기본값(7.5)보다 높여 프롬프트(색상/질감) 반영을 더 강하게 유도


def _round_to_multiple(value: int, multiple: int) -> int:
    return max(multiple, round(value / multiple) * multiple)


def _resized_data_uri(img: Image.Image, mime: str) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG" if mime == "image/png" else "JPEG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def inpaint_region(image_path: str, mask_path: str, prompt_keyword: str) -> bytes:
    settings = get_settings()
    if not settings.replicate_api_token:
        raise RuntimeError("Replicate API 토큰이 설정되어 있지 않습니다.")

    base_img = Image.open(image_path).convert("RGB")
    mask_img = Image.open(mask_path).convert("L")

    # 모델이 요구하는 "64의 배수" 제약에 맞춰 두 변을 각각 반올림한다 (약간의
    # 비율 왜곡은 감수 — 최대 32px 이내이므로 시각적으로 거의 차이가 없다).
    scale = min(1.0, MAX_EDGE_PX / max(base_img.size))
    target_w = _round_to_multiple(round(base_img.width * scale), 64)
    target_h = _round_to_multiple(round(base_img.height * scale), 64)
    if (target_w, target_h) != base_img.size:
        base_img = base_img.resize((target_w, target_h), Image.LANCZOS)
    if mask_img.size != base_img.size:
        mask_img = mask_img.resize(base_img.size, Image.NEAREST)

    # "같은 공간을 그대로 두고 해당 물건만 새로 설치한다"는 점을 명시해야 한다 —
    # 이 제약이 없으면 마스크가 조금만 넓어져도 모델이 기존 방을 보존하지 않고
    # 전혀 다른 인테리어 장면을 새로 만들어낸다(주방 사진이 거실로 바뀌었다).
    prompt = (
        f"{prompt_keyword}, photorealistic, "
        "matching original lighting, shadows and perspective, "
        "high quality interior photography"
    )
    negative_prompt = (
        "different room, new furniture, changed layout, extra objects, extra light fixtures, "
        "additional pendant lamp, duplicate items, people, "
        "cartoon, illustration, distorted, blurry, low quality, watermark, text, artifacts"
    )

    client = replicate.Client(api_token=settings.replicate_api_token)
    output = run_replicate_with_retry(
        client.run,
        INPAINT_TIMEOUT_S,
        INPAINT_MODEL,
        input={
            "image": _resized_data_uri(base_img, "image/png"),
            "mask": _resized_data_uri(mask_img.convert("RGB"), "image/png"),
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "width": target_w,
            "height": target_h,
            "guidance_scale": GUIDANCE_SCALE,
        },
    )
    if not output:
        raise RuntimeError("인페인팅 결과가 비어 있습니다 (빈 응답).")

    result_url = output[0] if isinstance(output, list) else output
    response = httpx.get(str(result_url), timeout=180)
    response.raise_for_status()
    return response.content
