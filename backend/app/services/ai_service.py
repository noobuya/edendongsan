"""수동 모드에서 지정한 영역을 극사실 수준으로 렌더링하는 파이프라인.

프론트엔드가 보내준 taskType에 따라 처리를 완전히 갈라 태운다.

  surface_change (시트지/썬팅)
    이미 있는 물건의 "마감만" 바꾸는 일이다. 손잡이·경첩·프레임 같은 구조가 사라지면
    시공 사진으로 못 쓴다. 그래서 원본을 적게 흔들고(denoise 0.45~0.6), 렌더링 뒤에
    원본의 명암 구조를 다시 얹어 디테일을 복원한다.

  object_creation (조명/실링팬/싱크볼)
    없던 물건을 새로 만들어야 하므로 마스크 안을 과감히 다시 그린다
    (denoise 0.85~0.95, steps 40+).

[색 번짐 차단]
어떤 경로를 타든 마지막에 원본 사진을 하드 마스크로 다시 덮어쓴다(paste back).
모델이 마스크 밖을 건드렸더라도 그 픽셀은 원본과 비트 단위로 같아진다 —
프롬프트로 부탁하는 것과 달리 이건 코드가 보장한다.

[ControlNet에 대한 실측 메모]
요구사항은 마스크 내부에 ControlNet(Canny/Depth)을 강제하는 것이었다. 그러나 이
계정에서 실제로 조회되는 Replicate 인페인팅 모델(stability-ai/stable-diffusion-
inpainting, lucataco/sdxl-inpainting, sepal/sdxl-inpainting, lucataco/realistic-
vision-v5-inpainting)은 하나도 controlnet 입력을 받지 않는다(모델 스키마를 직접
조회해 확인). 그래서 구조 보존은 외부 모델에 맡기지 않고 _reinject_structure()
에서 직접 수행한다 — 원본의 고주파(명암 구조)를 결과에 다시 얹는 방식이라
Canny ControlNet이 노리는 "윤곽 유지"와 같은 목적을 달성한다.
"""
import base64
import io
import os
import uuid

import cv2
import httpx
import numpy as np
import replicate
from PIL import Image, ImageFilter

from app.config import get_settings
from app.services.timeouts import run_replicate_with_retry

# [모델을 바꾼 이유 — 실측]
# 예전에는 sepal/sdxl-inpainting을 썼다. 이 모델은 마스크를 받기는 하지만 실제로는
# 거의 적용하지 않는다 — 화면의 21%를 마스크로 덮고 "matte black"을 요청해도 결과가
# 원본과 사실상 같았다(마스크 안 평균 [199,183,165] -> [194,180,164]). 그래서 사장님
# 화면에서는 "색을 바꿔도 아무 일도 안 일어나는" 것으로 보였다.
# 아래 모델은 이 저장소의 기존 부위별 편집(services/inpainting.py)에서 이미 검증된
# 진짜 인페인팅 모델이라 마스크 안을 확실히 다시 그린다. 버전을 함께 박아 둔다 —
# 커뮤니티 모델은 버전 없이 부르면 모델 단위 예측 경로로 가서 404가 난다.
INPAINT_MODEL = (
    "lucataco/sdxl-inpainting:"
    "a5b13068cc81a89a4fbeefeccc774869fcb34df4dbc92c1555e0f2771d49dde7"
)
# [표면 시공은 "지시 기반 편집"으로 간다]
# 인페인팅 모델 네 개(sepal/stability-ai/flux-fill/lucataco)를 같은 사진·같은 마스크로
# 실측했는데 전부 요청한 색을 내지 못했다 — 마스크 안을 "주변에 어울리는 무난한 색"으로
# 다시 그려서, 매트 블랙을 시켜도 흰 문짝이 그대로 나왔다. denoise를 0.95까지 올려도
# 같았다. 그래서 마스크+denoise 방식을 버리고, 말로 지시하면 그대로 고쳐 주는 편집
# 모델로 바꾼다(1차 시뮬레이션의 Gemini 장면 생성이 이미 같은 원리로 잘 동작한다).
# 이 모델은 마스크를 받지 않으므로, 구역 밖 보존은 우리가 _paste_back으로 보장한다.
EDIT_MODEL = "openai/gpt-image-2.5-flare"
EDIT_TIMEOUT_S = 240
# 이 모델의 denoise 입력 이름. 0에 가까우면 원본이 남고, 1에 가까우면 새로 그린다.
DENOISE_KEY = "strength"
RENDER_TIMEOUT_S = 180
MAX_EDGE_PX = 1024

# --- 극사실주의 마스터 프롬프트 ------------------------------------------------
# 사용자가 고른 자재("무광 화이트 시트지")만 보내면 모델은 자꾸 일러스트/3D 렌더처럼
# 그린다. 아래 문구를 항상 앞뒤로 합성해 "카메라로 찍은 사진"으로 고정한다.
MASTER_POSITIVE = (
    ", ultra-photorealistic, 8k resolution, architectural photography, "
    "shot on Canon EOS R5, 35mm lens, sharp focus, ray tracing, global illumination, "
    "highly detailed texture, raw photo"
)
MASTER_NEGATIVE = (
    "cartoon, illustration, 3d render, CGI, watercolor, painting, blurry, deformed, "
    "warped, unnatural lighting, oversaturated, plastic texture"
)

# 표면 변경: 원본 질감을 살리는 낮은 denoise + 구조 재주입
# 이 모델에는 denoise(prompt_strength) 입력이 없다 — 마스크 안을 늘 온전히 다시
# 그린다. 표면 변경에서 원래 구조(문짝 경계·손잡이 홈)를 지키는 일은 전적으로
# _reinject_structure가 맡는다.
SURFACE_PARAMS = {DENOISE_KEY: 0.8, "num_inference_steps": 40, "guidance_scale": 8.0}
SURFACE_SUFFIX = ""
# 시트지 시공면을 "새로 만들어 내도록" 지시하는 문장. 기존 무늬를 덮으라는 뜻이
# 분명해야 나뭇결이 비쳐 나오지 않는다.
SURFACE_TEMPLATE = (
    "A perfect, flawless {material} interior film applied smoothly on the {surface} surface. "
    "photorealistic, flat and clean texture, high-end architectural interior photography"
)
SURFACE_NEGATIVE = (
    "wood grain, old texture, transparent, blending, dirty, hallucination, distorted structure"
)
# 마스크 안쪽에서 원본 구조(윤곽·명암)를 얼마나 되살릴지. 1.0이면 원본 그대로라
# 색이 안 바뀌고, 0이면 구조가 사라진다.
STRUCTURE_STRENGTH = 0.18
# 무광 시트지는 예외다. 원본이 유광 싱크대라면 표면에 하이라이트(빛 반사 얼룩)가
# 잔뜩 있는데, 구조를 그대로 되살리면 그 반사까지 같이 살아나 "무광을 발랐는데
# 여전히 번들거리는" 결과가 된다. 윤곽만 겨우 남을 만큼 낮춰 반사를 지운다.
STRUCTURE_STRENGTH_MATTE = 0.12
# 이 단어가 들어간 자재는 무광으로 본다.
MATTE_KEYWORDS = ("무광", "매트", "matte")
# [구조 보존 2단계 — Canny 윤곽 가중치]
# STRUCTURE_STRENGTH는 마스크 전체에 균일하게 섞는 고주파 디테일이라, 손잡이·경첩
# 처럼 가늘고 뚜렷한 윤곽은 주변 텍스처 노이즈에 묻혀 약하게 살아난다. 진짜
# ControlNet(Canny)은 디퓨전 과정 자체를 그 윤곽선에 못박아 두지만, 이 계정의
# 인페인팅 모델은 ControlNet 입력을 못 받는다(위 [ControlNet에 대한 실측 메모]).
# 그래서 _reinject_structure에서 원본에 Canny를 직접 돌려 "뚜렷한 선"만 골라내고,
# 그 자리에는 STRUCTURE_STRENGTH보다 훨씬 센 가중치를 추가로 얹는다 — 생성 과정을
# 조건화하진 못해도, 최종 합성 단계에서 윤곽선 보존은 사실상 같은 효과를 낸다.
EDGE_BOOST = 0.55  # 윤곽선 픽셀에 추가로 얹는 가중치(균일 강도 위에 '더하는' 값)
EDGE_CANNY_THRESHOLDS = (30, 90)  # rendering.py의 천장 윤곽 추출과 같은 기준값
EDGE_DILATE_PX = 2  # 윤곽선을 살짝 두껍게 — 안티앨리어싱으로 한두 픽셀만 걸리면 거의 안 보임

# 물건 생성: 마스크 안을 새로 그리므로 높은 denoise + 많은 스텝
OBJECT_PARAMS = {DENOISE_KEY: 0.95, "num_inference_steps": 45, "guidance_scale": 9.0}
OBJECT_SUFFIX = (
    ", perfect integration, volumetric lighting, natural shadow cast on surrounding, "
    "realistic proportions"
)

# --- 구역별 커스텀 디자인(로고·문구) --------------------------------------------
# 카페·식당 시공에서는 시트지나 썬팅 위에 상호와 로고가 들어간다. 자재만 바꾸는
# 것과는 요구가 정반대다:
#   - 자재만 바꿀 때는 원본 구조를 최대한 지켜야 한다(문짝 경계, 손잡이 홈).
#   - 글씨를 넣을 때는 그 자리를 실제로 새로 그려야 한다. 원본을 너무 지키면
#     글씨가 아예 안 나오거나, 원본 타일 줄눈이 글씨 위로 비쳐 올라온다.
# 그래서 커스텀 디자인이 있으면 denoise를 올리고 구조 재주입은 확 낮춘다.
CUSTOM_DESIGN_PARAMS = {DENOISE_KEY: 0.85, "num_inference_steps": 50, "guidance_scale": 9.5}
STRUCTURE_STRENGTH_CUSTOM = 0.2
# 표면에 얹는 그림/로고는 인쇄물처럼 또렷해야 한다.
GRAPHIC_KEYWORDS = (
    ", clean vector graphics style, crisp edges, centered composition, "
    "professional signage design"
)
# 디퓨전 모델은 글자를 가장 못 그린다. 글자를 요청했을 때만 붙인다 —
# "빈티지 우드 실링팬"처럼 물건 모양을 말한 경우에 이 키워드가 붙으면
# 사진이어야 할 실링팬이 벡터 일러스트처럼 나온다.
TYPOGRAPHY_KEYWORDS = ", clear typography, crisp legible lettering, correctly spelled text"
TYPOGRAPHY_NEGATIVE = (
    ", misspelled text, garbled letters, distorted typography, random characters, "
    "duplicated letters, unreadable font"
)
# 이 말이 들어 있으면 글자를 그려달라는 요청으로 본다(따옴표도 같은 신호로 취급).
TEXT_HINTS = ("텍스트", "글씨", "글자", "문구", "로고", "상호", "간판", "레터링",
              "text", "logo", "sign", "letter", "typography", "wordmark")


def wants_text(custom_design: str) -> bool:
    """고객 요청이 '글자'를 그려달라는 것인지 판별한다."""
    design = (custom_design or "").strip()
    if not design:
        return False
    lowered = design.lower()
    if any(q in design for q in ("'", '"', "‘", "’", "“", "”")):
        return True
    return any(hint in lowered for hint in TEXT_HINTS)


def compose_prompt(
    base_prompt: str, custom_design: str = "", task_type: str = "surface_change"
) -> str:
    """항목 프롬프트에 고객의 추가 요청을 합성한다.

    [왜 task_type마다 붙이는 자리가 다른가]
      surface_change (시트지·썬팅) — 이미 있는 면 "위에" 무언가를 새기는 일이다.
        그래서 자재 문구 뒤에 디자인 지시를 덧붙인다.
          "matte white interior film finish, featuring a highly detailed design of ..."

      object_creation (실링팬·조명·싱크볼) — 만들 물건의 "모양과 스타일"을 정하는
        말이다. 뒤에 붙이면 모델이 물건과 무관한 배경 장식으로 흘려버리기 쉬우므로,
        명사 앞에 붙여 하나의 물건 이름이 되게 한다.
          "빈티지 우드" + "ceiling fan" -> "a 빈티지 우드 ceiling fan"
    """
    design = (custom_design or "").strip()
    if not design:
        return base_prompt

    if task_type == "object_creation":
        composed = f"a {design} {base_prompt}"
        # 물건은 사진이어야 하므로 그래픽 키워드를 붙이지 않는다.
        return composed + (TYPOGRAPHY_KEYWORDS if wants_text(design) else "")

    composed = (
        f'{base_prompt}, featuring a highly detailed design of "{design}" '
        "placed naturally and perfectly integrated on the surface"
        f"{GRAPHIC_KEYWORDS}"
    )
    return composed + (TYPOGRAPHY_KEYWORDS if wants_text(design) else "")


# 마스크 바운딩 박스에 두르는 여유 — 모델이 자연스럽게 이어붙일 만큼의 주변 맥락
# (벽·바닥 등)은 보여주되, 방 전체가 다 보일 만큼 넓히지는 않는다. 여유가 너무
# 넓으면 다시 "방 전체를 마음대로 재해석"하던 예전 문제로 돌아간다.
CROP_PAD_RATIO = 0.25
# 마스크가 아주 작아도(예: 손가락으로 콕 찍은 정도) 모델이 맥락을 알아볼 최소
# 크기는 보장한다 — 너무 좁게 자르면 무엇을 편집해야 하는지도 애매해진다.
MIN_CROP_PX = 320


def _padded_crop_box(bbox: tuple[int, int, int, int], image_size: tuple[int, int]) -> tuple[int, int, int, int]:
    """마스크 바운딩 박스 둘레에 여유(주변 맥락)를 두르고, 너무 작으면 최소 크기까지
    넓힌 뒤, 이미지 경계를 넘지 않게 자른다.

    [왜 방 전체가 아니라 이 작은 조각만 모델에 보내는가]
    편집 모델이 마스크를 못 받아 사진 전체를 다시 그리다 보니, 문짝 마스크 자리에
    원래 없던 물건(싱크대장 등)이 나타나는 사고가 있었다 — 모델이 방 전체를 자유롭게
    재해석할 수 있었기 때문이다. 크롭 범위를 좁혀 "그 자리에 원래 뭐가 있었는지"를
    지어낼 여지 자체를 없앤다."""
    left, top, right, bottom = bbox
    w, h = right - left, bottom - top
    pad_x = max(int(w * CROP_PAD_RATIO), (MIN_CROP_PX - w) // 2 if w < MIN_CROP_PX else 0)
    pad_y = max(int(h * CROP_PAD_RATIO), (MIN_CROP_PX - h) // 2 if h < MIN_CROP_PX else 0)
    img_w, img_h = image_size
    return (
        max(0, left - pad_x),
        max(0, top - pad_y),
        min(img_w, right + pad_x),
        min(img_h, bottom + pad_y),
    )


def render_region(
    image_path: str,
    mask_path: str,
    prompt: str,
    task_type: str,
    custom_design: str = "",
    option_id: str = "",
    category: str = "",
    door_material: str = "wood",
    preserve_geometry: bool = True,
) -> Image.Image:
    """영역 하나를 렌더링해 "마스크 밖은 원본 그대로"인 이미지를 돌려준다.

    custom_design은 그 구역에 넣을 문구나 그림(예: 중앙에 'Cafe 1984' 텍스트).
    비어 있으면 지금까지와 똑같이 자재만 바꾼다.

    door_material(door_frame 시공에서만 의미 있음)은 원래 문이 나무 문("wood")인지
    현관문·방화문처럼 페인트칠한 스틸 문("steel")인지 — build_instruction()이 이 값에
    따라 "나뭇결을 없애라"는 문구를 넣을지 말지를 정확히 가른다.

    preserve_geometry가 False면 표면 변경이어도 구조 재주입(_reinject_structure)을
    건너뛴다 — object_creation은 지킬 원본 구조가 없으므로 이 값과 무관하게 항상 꺼진다."""
    base = Image.open(image_path).convert("RGB")
    mask = _hard_mask(Image.open(mask_path).convert("L"), base.size)
    design = (custom_design or "").strip()

    if task_type == "object_creation":
        params, suffix, keep_structure = OBJECT_PARAMS, OBJECT_SUFFIX, False
    elif design:
        # 글씨·로고를 실제로 그려 넣어야 하므로 표면 변경보다 과감하게 다시 그린다.
        params, suffix, keep_structure = CUSTOM_DESIGN_PARAMS, SURFACE_SUFFIX, preserve_geometry
    else:
        params, suffix, keep_structure = SURFACE_PARAMS, SURFACE_SUFFIX, preserve_geometry

    if task_type != "object_creation":
        # [핵심 — "문짝이 사라지고 싱크대장이 나타나는" 등 엉뚱한 결과의 원인]
        # _run_edit이 쓰는 편집 모델은 마스크를 받지 않는다 — "문만 바꾸고 나머지는
        # 그대로 두라"는 말뿐인 부탁과 함께 사진 전체를 통째로 다시 상상해서 그린다.
        # 이 모델이 똑같은 구도로 전체 사진을 그대로 재현한다는 보장이 전혀 없어서,
        # 실제로 문짝 마스크 자리에 원래 없던 물건(싱크대장 등)이 나타난 사례가
        # 있었다 — 모델이 방 전체를 자유롭게 재해석하다 보니, 마스크 좌표에 해당하는
        # 자리를 자기 마음대로 그려 넣은 것이다.
        #
        # 고친 방식: 마스크의 바운딩 박스(+여유 폭)만 잘라내 그 작은 조각만 모델에
        # 보낸다 — 방 전체가 안 보이니 모델이 "이 자리에 원래 뭐가 있었는지"를
        # 재해석할 여지가 원천적으로 없어지고, 실제로 칠한 문짝·벽 등만 정확한
        # 위치에서 편집된다. 편집된 조각을 원본 사진의 그 좌표에 다시 붙여넣은 뒤,
        # 평소처럼 마스크로 한 번 더 걸러(_paste_back) 마스크 밖은 원본과
        # 완전히 동일하게 만든다.
        crop_bbox = mask.getbbox()
        crop_box = _padded_crop_box(crop_bbox, base.size) if crop_bbox else None
        edit_source = base.crop(crop_box) if crop_box else base

        try:
            edited = _run_edit(
                edit_source,
                build_instruction(option_id, category, design, door_material, _perspective_hint(mask)),
            )
        except Exception as exc:  # noqa: BLE001 - 외부 AI 실패는 아래 폴백으로 받는다
            # [AI가 실패해도 "색이 안 바뀌는" 일은 없어야 한다]
            # 외부 편집 모델(Replicate 경유 OpenAI)은 ReadTimeout·과부하로 종종 실패하고,
            # 예전에는 이 구역이 통째로 건너뛰어져 화면에는 아무 변화가 없었다(실측:
            # 딥 네이비를 지정했는데 결과 사진이 그대로였다). 고른 자재에 색이 있으면
            # 원본의 명암을 살린 채 색만 갈아끼우는 결정적 리컬러(네트워크 호출 없음)로
            # 대신한다. 문구·그림을 넣는 요청은 리컬러로 못 만드니 원래 오류를 올린다.
            recolored = None if design else _recolor(image_path, mask_path, option_id)
            if recolored is None:
                raise
            print(f"[ai_service] AI 편집 실패({type(exc).__name__}: {exc}) -> 간이 리컬러로 대체: {option_id}")
            # _recolor는 이미 원본과 같은 전체 크기라 조각을 다시 붙일 필요가 없다.
            return _paste_back(base, recolored, mask)

        if crop_box:
            rendered = base.copy()
            rendered.paste(edited, (crop_box[0], crop_box[1]))
        else:
            rendered = edited
        if keep_structure:
            # [중요] 이 surface_change 경로(_run_edit, OpenAI 경유 편집)가 실제 표면
            # 변경의 기본 경로다 — 아래 _run_inpaint+keep_structure 블록(object_creation
            # 전용)은 여기 도달하기 전에 항상 return하므로 그쪽에서는 절대 실행되지
            # 않는다. ControlNet 대신 원본의 명암 구조를 결과 위에 다시 얹어
            # 손잡이·프레임처럼 얇은 디테일이 뭉개지는 것을 막는다.
            rendered = _reinject_structure(base, rendered, mask, structure_strength(prompt, design))
        return _paste_back(base, rendered, mask)

    if task_type == "object_creation":
        negative = MASTER_NEGATIVE
        full_prompt = f"{compose_prompt(prompt, design, task_type)}{suffix}{MASTER_POSITIVE}"
    else:
        # 표면 시공은 "이 자재를 이 부위에 완벽히 시공한 새 표면"을 만들라고 지시한다.
        negative = MASTER_NEGATIVE + ", " + SURFACE_NEGATIVE
        full_prompt = SURFACE_TEMPLATE.format(
            material=material_label(option_id, prompt), surface=surface_label(category)
        )
        if design:
            # [3] 입력한 문구를 같은 프롬프트 끝에 자연스럽게 붙인다.
            full_prompt += f', with text "{design}" neatly applied'
        full_prompt += MASTER_POSITIVE
    if wants_text(design):
        negative += TYPOGRAPHY_NEGATIVE
    rendered = _run_inpaint(base, mask, full_prompt, params, negative)

    if keep_structure:
        # ControlNet 대신: 원본의 명암 구조를 결과 위에 다시 얹어 손잡이·프레임처럼
        # 얇은 디테일이 뭉개지는 것을 막는다. 다만 무광 자재는 원본의 광택까지
        # 되살아나면 안 되므로 강도를 낮춘다.
        rendered = _reinject_structure(base, rendered, mask, structure_strength(prompt, design))

    return _paste_back(base, rendered, mask)


def _recolor(image_path: str, mask_path: str, option_id: str) -> Image.Image | None:
    """고른 자재의 색으로 마스크 영역을 다시 칠한다. 색을 모르면 None."""
    from app.catalog import PATTERNS  # 순환 import 방지를 위해 지연 로드
    from app.services.rendering import recolor_surface

    pattern = PATTERNS.get(option_id)
    if pattern is None:
        return None
    out_path = f"{os.path.splitext(image_path)[0]}_recolor_{uuid.uuid4().hex[:8]}.png"
    recolor_surface(
        image_path,
        mask_path,
        pattern["color_hex"],
        out_path,
        # 예전엔 option_id에 "wood"라는 글자가 들어있는지로만 판단했다("oak-wood").
        # 현대보닥(BODAQ) 코드(예: "bodaq-w015")는 그 글자가 없어 이 방식으로는
        # 나뭇결 처리가 빠진다 — PATTERNS에 명시적으로 적어 둔 wood_grain을 먼저 보고,
        # 없으면(기존 항목들) 그동안 쓰던 글자 포함 여부로 물러선다.
        wood_grain=pattern.get("wood_grain", "wood" in option_id),
    )
    result = Image.open(out_path).convert("RGB")
    try:
        os.remove(out_path)  # 결과는 메모리로 옮겼으니 중간 파일은 남기지 않는다.
    except OSError:
        pass
    return result


def material_label(option_id: str, fallback: str) -> str:
    """프롬프트에 넣을 자재 이름.

    PATTERNS에 등록된 옵션이면 그 자재를 실제로 묘사한 prompt_keyword를 쓴다
    (예: "natural oak wood grain") — 현대보닥(BODAQ) 코드처럼 id 자체가 "bodaq-w015"
    같은 제품 코드라 그대로 풀면("bodaq w015") AI가 무슨 재질인지 못 알아듣는 경우를
    막는다. PATTERNS에 없는 옵션(옛 데이터 등)은 예전처럼 id를 그대로 풀어 쓴다."""
    from app.catalog import PATTERNS  # 순환 import 방지를 위해 지연 로드

    pattern = PATTERNS.get(option_id)
    keyword = pattern.get("prompt_keyword") if pattern else None
    if keyword:
        return keyword.replace(" interior film finish", "").strip()
    return (option_id or "").replace("_", " ").replace("-", " ").strip() or fallback


def surface_label(category: str) -> str:
    """시공 부위를 영문 명사로. 어디에 붙이는지 알려야 엉뚱한 걸 그리지 않는다.

    wall_film은 원래 이 표에 없어서 catalog.MANUAL_CATEGORY_PROMPTS의 "wall covering
    film"으로 대신 걸렸다 — "벽을 감싼 필름을 필름으로 바꿔라"처럼 순환적인 문장이
    돼(build_instruction이 뒤에 "... interior film applied"를 또 붙이므로), 벽 사진에서
    AI가 정확히 뭘 바꾸라는 건지 헷갈리기 쉬웠다. 다른 항목처럼 명확한 명사로 직접 둔다."""
    from app.catalog import MANUAL_CATEGORY_PROMPTS

    return {
        "film": "kitchen cabinet door",
        "sash": "window frame",
        "door_frame": "door and door frame",
        "wardrobe": "wardrobe door",
        "glass": "glass panel",
        "wall_film": "wall surface",
    }.get(category, MANUAL_CATEGORY_PROMPTS.get(category, "interior"))


def structure_strength(prompt: str, custom_design: str = "") -> float:
    """자재에 맞는 구조 복원 강도를 고른다.

    - 커스텀 디자인(로고·문구)이 있으면 가장 약하게. 원본의 고주파를 그대로 얹으면
      새로 그린 글씨 위로 원래 문짝 경계와 타일 줄눈이 비쳐 올라와 인쇄물이 아니라
      얼룩처럼 보인다.
    - 무광 마감이면 원본 하이라이트(광택 얼룩)가 따라 올라오지 않도록 약하게.
    - 그 외 일반 표면 변경은 기존대로 구조를 충분히 되살린다."""
    if (custom_design or "").strip():
        return STRUCTURE_STRENGTH_CUSTOM
    lowered = prompt.lower()
    return STRUCTURE_STRENGTH_MATTE if any(k in lowered for k in MATTE_KEYWORDS) else STRUCTURE_STRENGTH


# 모델 slug -> "slug:버전" 캐시.
# 버전을 코드에 박아두면 모델이 갱신될 때마다 사람이 고쳐야 하므로 처음 한 번만 조회한다.
_VERSIONED_SLUGS: dict[str, str] = {}


def _versioned(client: "replicate.Client", slug: str) -> str:
    """모델 주소에 버전을 붙여 돌려준다.

    [왜 버전을 반드시 붙여야 하나]
    replicate 라이브러리는 "owner/name"만 주면 모델 단위 예측 엔드포인트
    (POST /v1/models/{owner}/{name}/predictions)를 호출하는데, 이 경로는 Replicate가
    직접 운영하는 "공식 모델"에만 열려 있다. 커뮤니티 모델에 쓰면 모델이 멀쩡히
    존재해도 404가 떨어진다 — 실제로 이것 때문에 구역 재시공이 전부 실패하면서
    화면에는 "지정한 구역을 다시 그리지 못했습니다"만 떴다.
    버전을 붙이면 버전 단위 예측 경로로 가서 정상 동작한다."""
    if slug in _VERSIONED_SLUGS:
        return _VERSIONED_SLUGS[slug]
    if ":" in slug:
        _VERSIONED_SLUGS[slug] = slug
        return slug
    try:
        model = client.models.get(slug)
        version = getattr(model, "latest_version", None)
        resolved = f"{slug}:{version.id}" if version is not None else slug
    except Exception as exc:  # noqa: BLE001 - 조회 실패 시엔 원래 주소로 시도
        print(f"[ai_service] 모델 버전 조회 실패({slug}), 주소 그대로 사용: {exc}")
        resolved = slug
    _VERSIONED_SLUGS[slug] = resolved
    return resolved


def _run_edit(base: Image.Image, instruction: str) -> Image.Image:
    """말로 지시해 사진을 고친다. 결과는 항상 원본 크기로 되돌려 준다 —
    이 모델은 정해진 비율로 내보내기 때문에, 크기가 어긋난 채 합성하면
    마스크가 밀려 엉뚱한 자리가 시공된다."""
    settings = get_settings()
    if not settings.replicate_api_token:
        raise RuntimeError("Replicate API 토큰이 설정되어 있지 않습니다.")

    client = replicate.Client(api_token=settings.replicate_api_token)
    output = run_replicate_with_retry(
        client.run,
        EDIT_TIMEOUT_S,
        _versioned(client, EDIT_MODEL),
        input={
            "prompt": instruction,
            "input_images": [_data_uri(base)],
            "output_format": "png",
            "quality": "high",
            # 원본 비율에 가장 가까운 값을 고른다. 기본값(1:1)으로 받으면 정사각형이
            # 나오고, 그걸 원본 크기로 늘리는 순간 사진 속 문짝이 좌우로 밀려 마스크와
            # 어긋난다 — 시트지가 문 한쪽만 덮고 잘린 것처럼 보이는 원인이었다.
            # ("match_input_image"는 이 모델이 받지 않는 값이라 422로 거부됐다.)
            "aspect_ratio": _closest_aspect(base.size),
        },
    )
    if not output:
        raise RuntimeError("AI 편집 결과가 비어 있습니다 (빈 응답).")
    url = output[0] if isinstance(output, list) else output
    response = httpx.get(str(url), timeout=EDIT_TIMEOUT_S)
    response.raise_for_status()
    result = Image.open(io.BytesIO(response.content)).convert("RGB")
    return result.resize(base.size, Image.LANCZOS) if result.size != base.size else result


# 이 모델이 허용하는 출력 비율 (422 응답이 알려준 목록).
_ALLOWED_ASPECTS = {
    "1:1": 1 / 1,
    "3:2": 3 / 2,
    "2:3": 2 / 3,
    "4:3": 4 / 3,
    "3:4": 3 / 4,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
}


def _closest_aspect(size: tuple[int, int]) -> str:
    """원본 비율과 가장 가까운 허용 비율을 고른다.
    완전히 같지 않아도 되지만(결과를 원본 크기로 되돌리므로), 가까울수록
    사진 속 물건이 덜 늘어나 마스크와 잘 맞는다."""
    ratio = size[0] / size[1]
    return min(_ALLOWED_ASPECTS.items(), key=lambda kv: abs(kv[1] - ratio))[0]


# [카테고리별로 "실제로 뭘 지켜야 하는지"가 다르다 — 벽 사진에서 AI가 자주 헷갈리던 원인]
# 예전에는 door_frame이 아닌 모든 항목(벽면·샷시·유리·방충망 등)에 전부 "문 손잡이·
# 경첩을 지키라"는 문장을 그대로 보내고 있었다. 벽에는 문 손잡이도 경첩도 없으니
# 있지도 않은 걸 지키라는 모순된 지시가 된다 — 방화문 사진에서 "나뭇결을 없애라"고
# 잘못 지시하던 것과 똑같은 종류의 버그다. 항목마다 실제로 있는 것(벽은 스위치·
# 콘센트·걸레받이·모서리, 창틀은 창틀 단면과 잠금장치 등)을 정확히 알려준다.
PRESERVE_HINTS = {
    "film": "the cabinet door handles, hinges and structural geometry",
    "door_frame": "the door handle, hinges and structural geometry",
    "wardrobe": "the cabinet door handles, hinges and structural geometry",
    "sash": "the window frame profile, glass panes and locking hardware",
    "wall_film": "light switches, power outlets, corners, baseboards and existing wall structure",
    "glass": "the glass panel edges and frame",
    "mesh_screen": "the frame profile and structural geometry",
}
# 실제로 나무 마감이 흔한 항목(싱크대장·문짝·옷장)에서만 "나뭇결을 없애라"고 구체적으로
# 말해 기존 무늬를 강하게 덮어쓰게 한다(안 그러면 모델이 기존 나뭇결을 살짝 살려
# "색만 바뀐 듯 마는 듯"하게 그리는 경향이 있다 — 위 인페인팅 모델 실측 메모 참고).
# 벽·창틀·유리·방충망은 페인트·벽지·유리라 애초에 나뭇결이 없는 경우가 많아, 없는
# 걸 없애라고 하면 방화문 때와 똑같은 혼란을 준다 — 일반적인 "기존 마감"으로 대신한다.
WOOD_TYPICAL_CATEGORIES = {"film", "door_frame", "wardrobe"}


def _perspective_hint(mask: Image.Image) -> str:
    """마스크 모양만 보고 "이 면이 카메라 쪽에서 위/아래 중 어느 쪽으로 좁아지는지"를
    계산해 문장으로 돌려준다.

    진짜 깊이 추정(ControlNet-depth 같은)이 아니라 마스크의 위쪽/아래쪽 폭 비율만
    보는 값싼 근사치다 — 그래도 추가 API 호출 없이, 지금까지 프롬프트에 전혀 없던
    "이 면은 기울어 보인다"는 정보를 공짜로 준다. 거의 수직으로(정면으로) 보이는
    면은 비율이 1에 가까우므로 아무 말도 안 보태 괜한 지시로 결과를 흔들지 않는다."""
    bbox = mask.getbbox()
    if not bbox:
        return ""
    left, top, right, bottom = bbox
    height = bottom - top
    if height < 20:  # 너무 작은 영역은 위/아래 폭 비교가 노이즈라 의미 없다
        return ""
    arr = np.asarray(mask) > 127
    band = max(4, int(height * 0.15))
    top_width = int(arr[top : top + band, left:right].any(axis=0).sum())
    bottom_width = int(arr[bottom - band : bottom, left:right].any(axis=0).sum())
    if top_width < 4 or bottom_width < 4:
        return ""
    ratio = top_width / bottom_width
    if 0.88 <= ratio <= 1.12:
        return ""  # 거의 정면 — 특별히 말할 게 없다
    narrow_side = "top" if ratio < 1 else "bottom"
    return (
        f" This surface is seen at an angle where it visibly narrows toward the {narrow_side} "
        f"(it recedes away from the camera at the {narrow_side}) — render the film so it follows "
        f"that same taper, narrower at the {narrow_side}, not as an even frontal rectangle."
    )


def build_instruction(
    option_id: str,
    category: str,
    design: str,
    door_material: str = "wood",
    perspective_hint: str = "",
) -> str:
    """시공 지시문. 색만 말하지 않고 "기존 질감을 완전히 덮되 형태는 지키라"까지 적는다.

    [왜 문 재질을 따로 받는가 — 방화문 사진에서 AI가 실패/이상한 결과를 내던 원인]
    예전에는 door_frame 카테고리면 무조건 "old wood grain을 없애라"고 지시했다.
    하지만 현관문·방화문은 대부분 페인트칠한 스틸 문이라 애초에 나뭇결이 없다 —
    없는 걸 없애라는 모순된 지시를 받은 AI 편집 모델이 사진을 제대로 못 알아듣고
    결과를 못 내거나(방화문 사진에서 유독 실패), 엉뚱하게 그리는 원인이 됐다.
    door_material="steel"이면 나뭇결 언급을 빼고, 실제로 있는 것(페인트칠한 금속면,
    현관문에 흔한 디지털 도어록·외시경)을 지키라고 정확히 알려준다."""
    material = material_label(option_id, "matte white")
    surface = surface_label(category)

    if category == "door_frame" and door_material == "steel":
        preserve = "the door handle, digital door lock, peephole, hinges and structural geometry"
        surface_note = " This is a painted steel security/fire-rated entrance door (no wood grain originally)."
        covers_clause = "completely and evenly covers the existing painted metal surface"
    else:
        preserve = PRESERVE_HINTS.get(category, "the structural geometry and existing fixtures")
        surface_note = ""
        covers_clause = (
            "completely replaces the old wood grain"
            if category in WOOD_TYPICAL_CATEGORIES
            else "completely and evenly covers the existing surface finish and texture"
        )

    text = (
        f"Change the {surface} in this photo to have a flawless, completely opaque "
        f"{material} interior vinyl film applied.{surface_note}{perspective_hint} Make it look "
        f"highly detailed and photorealistic, and ensure the new thick film texture {covers_clause}, "
        f"while perfectly preserving {preserve}. Do not change anything else in the room."
    )
    if design:
        text += f', with the text "{design}" neatly applied on it'
    return text


def _run_inpaint(
    base: Image.Image,
    mask: Image.Image,
    prompt: str,
    params: dict,
    negative_prompt: str = MASTER_NEGATIVE,
) -> Image.Image:
    settings = get_settings()
    if not settings.replicate_api_token:
        raise RuntimeError("Replicate API 토큰이 설정되어 있지 않습니다.")

    work_base, work_mask, original_size = _fit_for_model(base, mask)
    client = replicate.Client(api_token=settings.replicate_api_token)
    output = run_replicate_with_retry(
        client.run,
        RENDER_TIMEOUT_S,
        _versioned(client, INPAINT_MODEL),
        input={
            "image": _data_uri(work_base),
            "mask": _data_uri(work_mask.convert("RGB")),
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            # 이 모델은 결과 크기를 직접 받는다. 보내는 사진과 어긋나면 마스크가
            # 밀려서 엉뚱한 자리가 시공된다.
            "width": work_base.width,
            "height": work_base.height,
            **params,
        },
    )
    if not output:
        raise RuntimeError("AI 렌더링 결과가 비어 있습니다 (빈 응답).")

    url = output[0] if isinstance(output, list) else output
    response = httpx.get(str(url), timeout=RENDER_TIMEOUT_S)
    response.raise_for_status()
    result = Image.open(io.BytesIO(response.content)).convert("RGB")
    return result.resize(original_size, Image.LANCZOS) if result.size != original_size else result


def _hard_mask(mask: Image.Image, size: tuple[int, int]) -> Image.Image:
    """가장자리가 흐린 마스크는 "반쯤 시공된" 띠를 만들어 색 번짐처럼 보인다.
    임계값으로 잘라 흰색(시공)/검정(보존) 두 값만 남긴다."""
    if mask.size != size:
        mask = mask.resize(size, Image.NEAREST)
    return mask.point(lambda v: 255 if v > 127 else 0, mode="L")


def _fit_for_model(base: Image.Image, mask: Image.Image):
    """모델이 다루기 좋은 크기(긴 변 1024, 8의 배수)로 줄인다. 결과는 다시 원본
    크기로 되돌려 합성하므로 원본 해상도는 잃지 않는다."""
    original_size = base.size
    scale = min(1.0, MAX_EDGE_PX / max(base.size))
    w = max(8, int(round(base.width * scale / 8)) * 8)
    h = max(8, int(round(base.height * scale / 8)) * 8)
    return base.resize((w, h), Image.LANCZOS), mask.resize((w, h), Image.NEAREST), original_size


def _edge_weight_map(base: Image.Image) -> np.ndarray:
    """원본에서 Canny로 뚜렷한 윤곽선만 뽑아, 그 자리에 얹을 추가 가중치 맵(0~EDGE_BOOST)을
    만든다. ControlNet처럼 생성 과정을 조건화하지는 못하지만, 손잡이·경첩·몰딩처럼
    "선 하나가 사라지면 바로 티가 나는" 디테일을 최종 합성 단계에서 강제로 못박는다."""
    gray = cv2.cvtColor(np.asarray(base), cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, *EDGE_CANNY_THRESHOLDS)
    if EDGE_DILATE_PX > 0:
        kernel = np.ones((EDGE_DILATE_PX, EDGE_DILATE_PX), np.uint8)
        edges = cv2.dilate(edges, kernel)
    return (edges.astype(np.float32) / 255.0) * EDGE_BOOST


def _reinject_structure(
    base: Image.Image, rendered: Image.Image, mask: Image.Image, strength: float
) -> Image.Image:
    """원본의 고주파(윤곽·요철)를 결과에 되돌려 준다.

    색과 재질은 AI가 만든 것을 쓰되, 밝기의 미세한 변화는 원본 것을 얹는다.
    시트지를 감싸도 손잡이 홈과 문짝 경계선이 그대로 남아 있어야 실제 시공 사진처럼
    보이기 때문이다.

    strength는 자재에 따라 달라진다(structure_strength 참고) — 무광 자재에 높은 값을
    쓰면 원본의 광택 얼룩까지 복원돼 무광으로 보이지 않는다. 그 위에 _edge_weight_map의
    Canny 가중치를 더해, 뚜렷한 윤곽선(손잡이·경첩·몰딩)만은 strength와 무관하게 거의
    항상 복원되게 한다 — EDGE_BOOST 참고."""
    base_arr = np.asarray(base, dtype=np.float32)
    rendered_arr = np.asarray(rendered, dtype=np.float32)

    # 저주파(뭉갠 것)를 뺀 나머지가 구조 성분이다.
    blur_radius = max(2.0, min(base.size) * 0.01)
    base_low = np.asarray(base.filter(ImageFilter.GaussianBlur(blur_radius)), dtype=np.float32)
    detail = base_arr - base_low

    total_strength = strength + _edge_weight_map(base)  # (H, W), 균일 강도 + 윤곽선 가중치
    mask_arr = np.asarray(mask, dtype=np.float32) / 255.0
    weight = (total_strength * mask_arr)[:, :, None]
    merged = rendered_arr + detail * weight
    return Image.fromarray(np.clip(merged, 0, 255).astype(np.uint8))


def _paste_back(base: Image.Image, rendered: Image.Image, mask: Image.Image) -> Image.Image:
    """마스크 밖은 원본 픽셀을 그대로 되돌린다 — 색 번짐 원천 차단.
    모델이 무엇을 하든 마스크 밖은 원본과 동일함이 코드로 보장된다."""
    result = base.copy()
    result.paste(rendered, (0, 0), mask)
    return result


def _data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
