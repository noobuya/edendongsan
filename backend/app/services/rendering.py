"""필름 시공 색상 리컬러와 조명/실링팬 합성.

색상 변경은 recolor_surface()가 담당한다 — 원본 사진의 명암(L)을 그대로 두고
색상(a/b)만 목표 색으로 갈아끼우는 방식이라, 문짝의 패널 홈/손잡이 그림자/
조명 그라데이션이 전부 살아 있어 "필름을 덮어씌운 스티커"가 아니라 실제로 그
색으로 시공하고 다시 찍은 사진처럼 보인다. 이전에 쓰던 (1) 타일링 텍스처
워핑과 (2) 디퓨전 인페인팅은 각각 "셀로판지를 얹은 듯한" 결과와 "색이 아예
반영되지 않는" 결과를 냈다.

조명/팬은 생성형 AI 인페인팅(services/inpainting.py)으로 실제로 그려 넣고,
API 호출이 실패했을 때만 composite_fixtures()로 제품 컷아웃 PNG를 원근에 맞춰
합성하는 폴백을 쓴다.
"""
import cv2
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


def recolor_surface(
    base_image_path: str,
    mask_path: str,
    color_hex: str,
    output_path: str,
    wood_grain: bool = False,
) -> str:
    """마스크 영역을 목표 색으로 "실제 시공된 것처럼" 다시 칠한다.

    왜 디퓨전 인페인팅을 쓰지 않는가 — stable-diffusion-inpainting은 마스크(흰색)
    영역의 원본 픽셀을 버리고 노이즈에서 새로 그린다. 그래서 입력 이미지를 미리
    원하는 색으로 물들여 보내도 그 색 정보는 모델에 전달되지 않고, 모델은 주변
    맥락(흰 벽/흰 상판)에 어울리는 무난한 흰 문짝을 다시 그려버린다. 실제로 딥
    네이비를 요청한 결과물의 마스크 안쪽 평균색을 재보니 (150,145,139)로 거의
    무채색이었다 — 즉 "AI 결과가 하나도 안 변한다"는 증상의 직접적인 원인이다.

    대신 원본 사진의 명암(L 채널)을 그대로 보존한 채 색상(a/b 채널)만 목표 색으로
    갈아끼운다. LAB 색공간에서:
      new_L = 목표색_L + (원본_L - 마스크영역_평균_L) x 대비이득
      new_a, new_b = 목표색의 a, b
    이렇게 하면 문짝의 패널 홈, 손잡이 그림자, 조명 그라데이션, 반사가 전부
    남은 채 색만 바뀌어 "필름을 붙여놓은 스티커"가 아니라 실제로 그 색으로
    시공하고 다시 찍은 사진처럼 보인다. 그리고 네트워크 호출이 없어 항상
    즉시, 100% 결정적으로 성공한다.
    """
    base = Image.open(base_image_path).convert("RGB")
    mask = Image.open(mask_path).convert("L")
    if mask.size != base.size:
        mask = mask.resize(base.size, Image.NEAREST)

    recolored = _recolor_pixels(base, mask, color_hex, wood_grain)

    # 경계를 살짝 흐려 합성 자국이 칼로 오린 듯 보이지 않게 한다.
    feather = max(1.0, base.width * 0.0025)
    soft_mask = mask.filter(ImageFilter.GaussianBlur(feather))

    Image.composite(recolored, base, soft_mask).save(output_path)
    return output_path


# 원본 명암의 진폭을 얼마나 유지할지의 상한. 1.0이면 원본 그대로.
_SHADING_GAIN = 0.95
# 리컬러 후 유지할 명암 진폭(LAB L, 0~255 기준)의 목표 표준편차.
# 흰 싱크대처럼 원본 대비가 큰 면(실측 표준편차 50)에 원본 진폭을 그대로 두면
# 밝은 쪽이 목표 색보다 훨씬 밝게 떠서 딥 네이비가 하늘색, 올리브 그린이
# 연두색처럼 보인다. 진폭을 이 값에 맞춰 눌러 색은 정확히 내면서 굴곡은 남긴다.
_TARGET_SHADING_SPREAD = 26.0
# 강한 반사(스포트 하이라이트)는 색을 입혀도 살아있어야 자연스럽다.
_HIGHLIGHT_THRESHOLD_SIGMA = 1.5
_HIGHLIGHT_GAIN = 0.6
# 우드 패턴은 색만으로는 표현되지 않으므로 결(grain)을 명암에 얹는다.
# assets/patterns의 우드 텍스처는 실제 나뭇결이 아니라 굵은 가로 줄무늬라
# 타일링하면 이음매가 그대로 띠처럼 드러나므로 쓰지 않고, 아래에서 절차적으로
# 미세한 결을 생성한다.
_GRAIN_AMPLITUDE = 7.0
# [덧방(셀로판지) 방지] 원본의 "잔무늬"를 얼마나 남길지.
# 명암(L)을 그대로 두면 나뭇결·타일 줄눈 같은 잔무늬가 새 색 위로 비쳐 올라와
# 필름이 아니라 색깔 셀로판지를 덮은 것처럼 보인다. 실제 시트지는 불투명해서
# 그 무늬를 덮어버린다. 그래서 큰 명암(문짝 굴곡·조명 그라데이션)은 그대로 두고
# 고주파 잔무늬만 이 비율로 눌러 준다 — 0이면 완전 불투명, 1이면 예전처럼 다 비침.
_TEXTURE_KEEP = 0.28
# 우드 필름은 결 자체가 자재의 무늬라 조금 더 남겨 자연스럽게 만든다.
_TEXTURE_KEEP_WOOD = 0.45


def _recolor_pixels(
    base: Image.Image, mask: Image.Image, color_hex: str, wood_grain: bool
) -> Image.Image:
    lab = np.asarray(base.convert("LAB"), dtype=np.float32)
    sel = np.asarray(mask, dtype=np.float32) > 127
    if not sel.any():
        return base

    target = np.asarray(
        Image.new("RGB", (1, 1), _hex_to_rgb(color_hex)).convert("LAB"), dtype=np.float32
    ).reshape(3)

    lightness = lab[..., 0]
    mean_l = float(lightness[sel].mean())
    std_l = float(lightness[sel].std()) or 1.0

    gain = min(_SHADING_GAIN, _TARGET_SHADING_SPREAD / std_l)
    new_l = target[0] + (lightness - mean_l) * gain
    # 평균보다 훨씬 밝은 픽셀(창/조명 반사)은 추가로 더 밝게 남긴다.
    excess = np.clip(lightness - (mean_l + _HIGHLIGHT_THRESHOLD_SIGMA * std_l), 0, None)
    new_l = new_l + excess * _HIGHLIGHT_GAIN

    # 잔무늬(고주파)만 골라 눌러 원본 무늬가 비치지 않게 한다.
    # 저주파(큰 굴곡·조명)는 그대로 두므로 입체감은 살아 있다.
    blur_radius = max(1.5, min(base.size) * 0.006)
    low = np.asarray(
        Image.fromarray(np.clip(new_l, 0, 255).astype(np.uint8), mode="L").filter(
            ImageFilter.GaussianBlur(blur_radius)
        ),
        dtype=np.float32,
    )
    keep = _TEXTURE_KEEP_WOOD if wood_grain else _TEXTURE_KEEP
    new_l = low + (new_l - low) * keep

    if wood_grain:
        new_l = new_l + _wood_grain_layer(base.size) * _GRAIN_AMPLITUDE

    out = lab.copy()
    out[..., 0] = np.clip(new_l, 0, 255)
    out[..., 1] = target[1]
    out[..., 2] = target[2]
    return Image.fromarray(out.astype(np.uint8), mode="LAB").convert("RGB")


def _hex_to_rgb(color_hex: str) -> tuple[int, int, int]:
    h = color_hex.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _wood_grain_layer(size: tuple[int, int]) -> np.ndarray:
    """가로로 길게 흐르는 미세한 나뭇결을 절차적으로 만든다 (-1~1 정규화).

    x 방향으로는 천천히, y 방향으로는 촘촘하게 변하는 노이즈를 만들면 결이
    가로로 길게 이어진다 — 낮은 해상도로 뽑은 노이즈를 세로로만 크게 늘리는
    방식으로 구현한다 (매번 같은 결이 나오도록 시드를 고정).
    """
    width, height = size
    rng = np.random.default_rng(20240517)
    coarse = rng.standard_normal((max(4, height // 3), max(4, width // 48))).astype(np.float32)

    noise_img = Image.fromarray(((coarse * 40) + 128).clip(0, 255).astype(np.uint8), mode="L")
    stretched = noise_img.resize(size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))

    arr = np.asarray(stretched, dtype=np.float32)
    spread = float(arr.std()) or 1.0
    return (arr - arr.mean()) / spread


# --- 천장 인식 / 기존 등 제거 / 다운라이트 렌더링 -----------------------------
CEILING_WORK_WIDTH = 480  # 천장 탐색용 축소 해상도 (속도와 노이즈 억제)
CEILING_SEED_ROW_RATIO = 0.06  # 씨앗 픽셀을 고를 상단 영역 비율
CEILING_SEARCH_ROW_RATIO = 0.55  # 천장이 존재할 수 있는 최대 세로 위치
CEILING_FLOOD_TOLERANCE = 14  # 영역 확장 시 허용할 밝기 차이
CEILING_MIN_AREA_RATIO = 0.015  # 이보다 작으면 천장 인식 실패로 본다
CEILING_MAX_AREA_RATIO = 0.5  # 이보다 크면 벽/장까지 새어나간 것으로 보고 실패 처리


def detect_ceiling_mask(image_path: str) -> Image.Image | None:
    """사진에서 천장 영역을 밝기 기반 영역 확장으로 찾는다.

    Gemini 분류를 쓸 수 없을 때(크레딧 소진 등) 천장을 "화면 상단 35% 사각형"으로
    가정하면, 실제로는 벽이나 상부장인 곳에 실링팬이 얹혀 허공에 뜬 것처럼 보인다.
    천장은 대개 사진 위쪽 가장자리에 붙어 있고 밝고 균일하다는 성질을 이용해,
    상단에서 밝은 픽셀을 씨앗으로 잡고 비슷한 밝기로 이어지는 영역만 넓혀 나간다.
    """
    with Image.open(image_path) as img:
        rgb = img.convert("RGB")
        full_size = rgb.size
        ratio = CEILING_WORK_WIDTH / rgb.width
        small = rgb.resize((CEILING_WORK_WIDTH, max(1, round(rgb.height * ratio))), Image.BILINEAR)

    gray = np.asarray(small.convert("L"), dtype=np.uint8)
    h, w = gray.shape

    # 천장과 벽/상부장은 밝기가 비슷해 밝기만으로 확장하면 화면 위쪽 전체가 하나로
    # 이어져 버린다(실측: 서로 다른 사진 3장 모두 상단 60%가 통째로 잡혔다).
    # 그래서 윤곽선을 미리 "벽"으로 깔아 두고 그 선을 넘지 못하게 한다.
    smoothed = cv2.GaussianBlur(gray, (5, 5), 0)
    barriers = cv2.dilate(cv2.Canny(smoothed, 30, 90), np.ones((3, 3), np.uint8))
    barrier_mask = (barriers > 0).astype(np.uint8)

    # 씨앗 하나만 쓰면 그 점이 하필 형광등 안이나 몰딩 위에 떨어졌을 때 통째로
    # 실패한다 — 상단 여러 지점에서 시도해 가장 그럴듯한(가장 넓은) 영역을 고른다.
    seed_y = max(1, int(h * CEILING_SEED_ROW_RATIO))
    best: np.ndarray | None = None
    for x_ratio in (0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9):
        seed_x = int(w * x_ratio)
        if barrier_mask[seed_y, seed_x]:
            continue

        flood_mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
        flood_mask[1:-1, 1:-1] = barrier_mask
        cv2.floodFill(
            smoothed.copy(),
            flood_mask,
            (seed_x, seed_y),
            255,
            loDiff=CEILING_FLOOD_TOLERANCE,
            upDiff=CEILING_FLOOD_TOLERANCE,
            flags=cv2.FLOODFILL_MASK_ONLY | (128 << 8),
        )
        # 채워진 픽셀은 128로 표시된다 (미리 깔아둔 윤곽선 1과 구분해야 한다).
        region = flood_mask[1:-1, 1:-1] == 128

        # 천장은 화면 아래쪽까지 내려오지 않는다 — 아래로 새어나간 부분은 잘라낸다.
        region[int(h * CEILING_SEARCH_ROW_RATIO) :, :] = False
        # 윤곽선으로 뚫린 틈 때문에 등/몰딩 자리가 구멍으로 남지 않게 메운다.
        region = (
            cv2.morphologyEx(
                region.astype(np.uint8),
                cv2.MORPH_CLOSE,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)),
            )
            > 0
        )

        coverage = float(region.mean())
        if not (CEILING_MIN_AREA_RATIO <= coverage <= CEILING_MAX_AREA_RATIO):
            continue
        if best is None or region.sum() > best.sum():
            best = region

    if best is None:
        return None

    mask = Image.fromarray((best * 255).astype(np.uint8), mode="L")
    return mask.resize(full_size, Image.NEAREST)


# 천장으로 보기에 최소한 이 정도는 가로로 넓어야 한다는 기준 — 실측 결과 SAM+
# Gemini가 스테인리스 후드 덕트(밝고 세로로 긴 물체)를 "천장"으로 잘못 고른 사례가
# 있었다. 그 마스크는 면적 기준(MIN_SURFACE_AREA_RATIO)은 통과할 만큼 컸지만 화면
# 가로폭의 15%짜리 세로 띠 하나였다 — 그 마스크를 그대로 믿고 실링팬/다운라이트
# 위치를 계산하면 전부 그 좁은 세로 띠 안에 몰려버린다(실제 증상: 다운라이트
# 6개가 한 덩어리로 뭉쳐 보임 + 기존 형광등이 이 마스크 범위 밖이라 못 찾아 철거도
# 안 됨). 천장은 (1) 가로로 화면의 상당 부분을 덮고 (2) 위쪽에 걸쳐 있어야 한다.
CEILING_PLAUSIBLE_MIN_WIDTH_SPAN = 0.35
CEILING_PLAUSIBLE_MAX_HEIGHT_SPAN = 0.75


def is_plausible_ceiling(mask: Image.Image) -> bool:
    arr = np.asarray(mask.convert("L")) > 127
    ys, xs = np.nonzero(arr)
    if len(xs) == 0:
        return False
    w, h = mask.size
    width_span = (xs.max() - xs.min()) / w
    height_span = (ys.max() - ys.min()) / h
    return width_span >= CEILING_PLAUSIBLE_MIN_WIDTH_SPAN and height_span <= CEILING_PLAUSIBLE_MAX_HEIGHT_SPAN


def ceiling_placement(mask: Image.Image) -> dict | None:
    """천장 마스크에서 조명/실링팬을 달 위치를 뽑아낸다 (0~1 정규화).

    마스크 전체의 중심을 쓰면 안 된다 — 천장과 상부장은 색이 거의 같아 영역
    확장이 아래로 새는 경우가 있고(실측: 흰 상부장 주방에서 천장 영역이 장 앞면까지
    번졌다), 그 중심은 천장이 아니라 장 위에 찍힌다. 화면 위쪽일수록 천장이 확실
    하므로 마스크 픽셀의 상위 30% 지점을 기준 행으로 삼는다.
    """
    arr = np.asarray(mask.convert("L")) > 127
    ys, xs = np.nonzero(arr)
    if len(ys) == 0:
        return None

    h, w = arr.shape
    anchor_row = float(np.percentile(ys, 30))
    band = ys <= max(anchor_row, ys.min() + 1)
    band_xs = xs[band]
    if len(band_xs) == 0:
        band_xs = xs

    # 다운라이트를 2열(그리드)로 배치할 때 쓸 두 번째 기준 행 — 첫 행보다 더
    # 아래(시야에 조금 더 가까운) 지점을 잡는다. 실제 시공에서 다운라이트 개수가
    # 많으면(5개 이상) 한 줄로 늘어놓지 않고 여러 줄로 나눠 배치하는 것과 같다.
    row2 = float(np.percentile(ys, 55))
    band2 = (ys > anchor_row) & (ys <= max(row2, anchor_row + 1))
    band2_xs = xs[band2] if band2.any() else band_xs

    return {
        "y": anchor_row / h,
        "x": float(np.median(band_xs)) / w,
        "x_min": float(np.percentile(band_xs, 5)) / w,
        "x_max": float(np.percentile(band_xs, 95)) / w,
        "y2": row2 / h,
        "x_min2": float(np.percentile(band2_xs, 5)) / w,
        "x_max2": float(np.percentile(band2_xs, 95)) / w,
    }


def detect_existing_lights(image_path: str, ceiling_mask: Image.Image | None) -> Image.Image | None:
    """천장에 이미 달려 있는 조명(형광등/펜던트)의 위치를 밝은 덩어리로 찾아낸다.
    새 조명을 설치하려면 기존 등을 먼저 지워야 시공 후 모습이 맞기 때문이다.

    "천장 마스크 전체의 평균보다 훨씬 밝은 픽셀"이라는 예전 기준은 두 가지 이유로
    실패했다. 1) detect_ceiling_mask는 천장뿐 아니라 상부장 앞면까지 함께 잡는데,
    조명 없이도 카메라와 가까운 흰 상부장이 오히려 형광등 표면보다 더 밝게 찍혀
    "천장 평균"을 끌어올려 기준이 형광등보다 높아져 버렸다(실측: 등 영역 중앙값
    211 vs 마스크 전체 상위 25% 밝기 237). 2) 기준을 겨우 넘긴 픽셀도 표면 얼룩덜룩한
    반사 탓에 20px 미만의 작은 조각들로 흩어져(실측 120개 조각, 최대 27px), 최소
    묶음 크기(min_blob)를 넘는 덩어리가 하나도 안 남았다.
    그래서 (a) 카메라에 더 가까운 아래쪽(상부장이 섞여 있을 가능성이 큰 영역)을
    제외하고 마스크 상단 40%만 기준 삼고, (b) 그 안에서의 상대 밝기 백분위수(상위
    15%)로 기준을 잡는다 — 사진마다 노출이 달라도 "이 사진 안에서 상대적으로
    가장 밝은 부분"은 안정적으로 형광등/펜던트 위치와 일치한다."""
    with Image.open(image_path) as img:
        rgb = img.convert("RGB")
    gray = np.asarray(rgb.convert("L"), dtype=np.uint8)
    h, w = gray.shape

    if ceiling_mask is not None:
        area = np.asarray(ceiling_mask.convert("L").resize((w, h), Image.NEAREST)) > 127
    else:
        area = np.zeros((h, w), dtype=bool)
        area[: int(h * 0.4), :] = True
    if not area.any():
        return None

    ys, _xs = np.nonzero(area)
    y_cutoff = np.percentile(ys, 40)
    top_area = area.copy()
    top_area[int(y_cutoff) :, :] = False
    if not top_area.any():
        top_area = area

    bright_threshold = max(200.0, float(np.percentile(gray[top_area], 85)))
    bright = top_area & (gray >= bright_threshold)
    if bright.sum() < (w * h) * 0.0005:
        return None

    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        bright.astype(np.uint8), connectivity=8
    )
    keep = np.zeros((h, w), dtype=np.uint8)
    min_blob = max(40, int(w * h * 0.0004))
    for i in range(1, count):
        if stats[i, cv2.CC_STAT_AREA] >= min_blob:
            keep[labels == i] = 255
    if not keep.any():
        return None

    # 밝게 빛나는 건 전구/커버뿐이고 등 갓·레일·배선은 어두워서 밝기로는 안 잡힌다.
    # 그 주변까지 넉넉히 덮어야 "새 조명을 달았는데 옛날 등의 검은 막대가 그대로
    # 남아 있는" 결과가 나오지 않는다.
    pad = max(6, int(w * 0.03))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad * 2 + 1, pad * 2 + 1))
    return Image.fromarray(cv2.dilate(keep, kernel), mode="L")


def erase_ceiling_light(image_path: str, light_mask_path: str, output_path: str) -> str:
    """기존 천장등을 지운다 — 생성형 AI 인페인팅 대신 OpenCV 고전 인페인팅(Telea)을 쓴다.

    처음엔 stable-diffusion-inpainting에 "빈 천장으로 채워라"는 프롬프트를 줘서
    지우려 했는데, 실측 결과 마스크 안쪽에 거의 똑같이 밝고 길쭉한 형광등 모양을
    다시 그려 넣어 사실상 아무것도 안 지워진 것처럼 나왔다 — 마스크 형태 자체가
    "여기엔 밝은 광원이 있다"는 강한 신호라, 모델이 빈 천장보다 그 신호를 우선한
    것으로 보인다(색상 리컬러에서 겪은 것과 같은 종류의 문제).
    반면 천장처럼 배경이 단색에 가까운 면에서 국소적인 물체 하나를 지우는 작업은
    고전 인페인팅(주변 텍스처를 안쪽으로 전파)이 정확히 잘 하는 일이라, 실제로
    형광등이 완전히 사라지고 매끈한 천장만 남는 것을 확인했다. 네트워크 호출도
    없어 항상 즉시 성공한다."""
    base_bgr = cv2.imread(image_path)
    mask = cv2.imread(light_mask_path, cv2.IMREAD_GRAYSCALE)
    if mask.shape[:2] != base_bgr.shape[:2]:
        mask = cv2.resize(mask, (base_bgr.shape[1], base_bgr.shape[0]), interpolation=cv2.INTER_NEAREST)

    # 광원 주변으로 번지는 halo/glow까지 함께 지우도록 마스크를 넉넉히 팽창시킨다.
    pad = max(10, int(base_bgr.shape[1] * 0.02))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad * 2 + 1, pad * 2 + 1))
    mask = cv2.dilate(mask, kernel)

    result = cv2.inpaint(base_bgr, mask, 15, cv2.INPAINT_TELEA)
    cv2.imwrite(output_path, result)
    return output_path


def draw_downlights(base_image_path: str, spots: list[dict], output_path: str) -> str:
    """매입 다운라이트를 사진 위에 직접 그린다.

    디퓨전 인페인팅에 맡기면 다운라이트 한 개의 마스크가 40px 남짓이라 형태를
    만들어내지 못하고 뿌옇게 뭉개져 "아무것도 안 달린 것"처럼 보였다. 아래에서
    올려다본 매입등은 '밝은 원 + 주변으로 번지는 빛' 두 층이면 충분히 사실적이라,
    확실하게 보이도록 직접 그린다.
    """
    base = Image.open(base_image_path).convert("RGB")
    width, height = base.size

    glow = Image.new("L", base.size, 0)
    glow_draw = ImageDraw.Draw(glow)
    core = Image.new("L", base.size, 0)
    core_draw = ImageDraw.Draw(core)

    for spot in spots:
        cx, cy = spot["x"] * width, spot["y"] * height
        r = max(spot.get("radius_ratio", 0.018) * width, 5.0)
        glow_draw.ellipse([cx - r * 3.2, cy - r * 3.2, cx + r * 3.2, cy + r * 3.2], fill=110)
        core_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)

    glow = glow.filter(ImageFilter.GaussianBlur(max(4, width * 0.012)))
    core = core.filter(ImageFilter.GaussianBlur(max(1.2, width * 0.0018)))

    warm = Image.new("RGB", base.size, (255, 244, 224))
    lit = Image.composite(warm, base, glow)  # 천장으로 번지는 빛
    lit = Image.blend(base, lit, 0.55)
    lit = Image.composite(Image.new("RGB", base.size, (255, 250, 238)), lit, core)  # 등 본체

    lit.save(output_path)
    return output_path


def tint_fixture_png(png_path: str, color_hex: str) -> Image.Image:
    """제품 컷아웃 PNG(실링팬 등)를 목표 색으로 물들인다 (알파는 그대로 유지).

    AI 인페인팅으로 실링팬을 그려 넣을 때는 프롬프트에 색상 형용사를 넣어 처리하지만
    (pipeline._fan_prompt), 그 호출이 실패했을 때의 컷아웃 합성 폴백은 고정 검정
    아이콘 PNG 하나뿐이라 사용자가 고른 색이 전혀 반영되지 않았다. 명도 기반
    듀오톤(어두운 부분=검정에 가깝게, 밝은 부분=목표색에 가깝게)으로 칠해, 폴백
    경로를 타더라도 선택한 색이 대략이나마 반영되게 한다."""
    img = Image.open(png_path).convert("RGBA")
    arr = np.asarray(img, dtype=np.float32)
    rgb, alpha = arr[..., :3], arr[..., 3:4]
    luminance = rgb.mean(axis=-1, keepdims=True) / 255.0
    color = np.asarray(_hex_to_rgb(color_hex), dtype=np.float32).reshape(1, 1, 3)
    tinted_rgb = luminance * color
    out = np.concatenate([np.clip(tinted_rgb, 0, 255), alpha], axis=-1)
    return Image.fromarray(out.astype(np.uint8), mode="RGBA")


def composite_fixtures(
    base_image_path: str,
    fixtures: list[dict],
    output_path: str,
    ceiling_mask_path: str | None = None,
) -> str:
    base = Image.open(base_image_path).convert("RGBA")
    perspective_scale = _build_perspective_scaler(ceiling_mask_path)

    for fx in fixtures:
        product = Image.open(fx["product_png_path"]).convert("RGBA")
        scale = fx.get("scale", 0.15) * perspective_scale(fx["y"])

        new_w = max(1, int(base.width * scale))
        new_h = max(1, int(product.height * (new_w / product.width)))
        product = product.resize((new_w, new_h), Image.LANCZOS)

        px = int(fx["x"] * base.width - new_w / 2)
        py = int(fx["y"] * base.height - new_h / 2)

        shadow = _make_drop_shadow(product)
        base.alpha_composite(shadow, (px, py + int(new_h * 0.22)))
        base.alpha_composite(product, (px, py))

    base.convert("RGB").save(output_path)
    return output_path


def build_fixture_mask(base_image_path: str, fixtures: list[dict]) -> Image.Image:
    """조명/실링팬을 "설치할" 위치에 흰 원을 그린 인페인팅용 마스크를 만든다.
    scale은 composite_fixtures()의 "제품 폭 = 이미지 폭 × scale" 규칙과 같은
    의미이므로, 반경은 그 절반(폭의 절반)에 설치 흔적을 위한 약간의 여유(1.3배)만
    더한다 — 이전에 0.9를 그대로 곱했더니 반경이 의도한 크기의 거의 2배가 되어
    실링팬 마스크가 화면 절반을 뒤덮고 조명 마스크까지 집어삼켜, 결과물이 조명
    3개가 아니라 정체불명의 거대한 원반 하나로 나오는 문제가 있었다."""
    with Image.open(base_image_path) as img:
        width, height = img.size

    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for fx in fixtures:
        cx = fx["x"] * width
        cy = fx["y"] * height
        # 너무 작은 마스크(예: 다운라이트 50px)는 디퓨전 모델이 형태를 만들어내지
        # 못하고 뿌옇게 뭉개져 "아무것도 안 바뀐 것처럼" 보인다 — 최소 반경을 둔다.
        radius = max(fx.get("scale", 0.12) * width * 0.5 * 1.3, width * 0.06)
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=255)
    return mask


# 실링팬 인페인팅 프롬프트에 색상 형용사(예: "warm beige blades")를 넣어도 실측 결과
# AI가 매번 짙은 회색/검정 팬만 그려내는 경향이 있었다 — 색상 프롬프트가 사실상
# 무시된다. build_fixture_mask()가 만드는 원형 마스크는 팬 몸체뿐 아니라 날개
# 사이로 보이는 천장 배경까지 포함하므로, 그 안에서 "실제로 어두운(=팬으로 추정되는)"
# 픽셀만 다시 골라내 recolor_surface로 확실하게 색을 입힌다.
#
# 단순 밝기 임계값 하나로는 부족했다 — 실측 결과 원형 마스크 안에 그림자 진 천장
# 구석 같은 "팬이 아닌데 어두운" 영역이 함께 들어 있어, 임계값을 낮게 잡으면 팬의
# 가는 날개 끝이 잘리고 높게 잡으면 그 그림자 구석까지 통째로 물든다. 그래서
# 임계값으로 어두운 픽셀을 고른 뒤, 그중 "가장 넓은 하나의 연결된 덩어리"만 남긴다
# — 팬은 모터 허브를 중심으로 날개가 전부 이어진 하나의 덩어리인 반면, 그림자
# 구석은 보통 별도의 작은 덩어리로 떨어져 있어 이 방식으로 깔끔히 갈린다(실측
# 이미지로 임계값 90/110/130을 비교해 110에서 팬 모양만 정확히 분리됨을 확인).
DARK_OBJECT_LIGHTNESS_THRESHOLD = 110.0


def build_dark_object_mask(
    image_path: str, area_mask_path: str, lightness_threshold: float = DARK_OBJECT_LIGHTNESS_THRESHOLD
) -> Image.Image:
    """area_mask_path 영역 안에서, 어두운 픽셀 중 가장 넓게 연결된 하나의 덩어리만
    골라낸 정밀 마스크를 만든다 (물체로 추정되는 부분만 남기고 그림자 등은 제외)."""
    base = Image.open(image_path).convert("RGB")
    area = Image.open(area_mask_path).convert("L")
    if area.size != base.size:
        area = area.resize(base.size, Image.NEAREST)

    area_arr = np.asarray(area) > 127
    lightness = np.asarray(base.convert("LAB"), dtype=np.float32)[..., 0]
    dark = (area_arr & (lightness < lightness_threshold)).astype(np.uint8)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    if num_labels <= 1:
        return Image.fromarray(dark * 255, mode="L")
    largest_label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    largest = (labels == largest_label).astype(np.uint8)

    # 팬 날개는 얇고 가늘어서, 픽셀 단위로 뚫린 구멍이 생기면 리컬러 결과에 얼룩진
    # 부분이 남는다 — 살짝 팽창시켜 매끈하게 이어지는 하나의 물체로 만든다.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    largest = cv2.dilate(largest, kernel)
    return Image.fromarray((largest * 255).astype(np.uint8), mode="L")


def _make_drop_shadow(product: Image.Image, opacity: int = 110) -> Image.Image:
    """제품 PNG의 실루엣을 눌러 바닥에 깔린 듯한 부드러운 그림자로 변환한다."""
    alpha = product.split()[3].point(lambda a: min(a, opacity))
    squashed_h = max(1, int(product.height * 0.4))
    squashed_alpha = alpha.resize((product.width, squashed_h))

    canvas_alpha = Image.new("L", product.size, 0)
    canvas_alpha.paste(squashed_alpha, (0, product.height - squashed_h))

    shadow = Image.new("RGBA", product.size, (10, 10, 10, 0))
    shadow.putalpha(canvas_alpha)
    blur_radius = max(3, product.width // 14)
    return shadow.filter(ImageFilter.GaussianBlur(blur_radius))


def _build_perspective_scaler(ceiling_mask_path: str | None):
    """천장 마스크 내 세로 위치(y, 0~1)에 따라 0.75~1.25배 사이로 스케일을 보정하는
    함수를 반환한다. 마스크가 없으면 항상 1.0배(보정 없음)로 동작한다."""
    if not ceiling_mask_path:
        return lambda _y: 1.0

    mask = np.array(Image.open(ceiling_mask_path).convert("L"))
    ys, _xs = np.nonzero(mask > 127)
    if len(ys) == 0:
        return lambda _y: 1.0

    y0, y1 = float(ys.min()) / mask.shape[0], float(ys.max()) / mask.shape[0]
    span = max(y1 - y0, 1e-3)

    def scaler(y_norm: float) -> float:
        t = min(max((y_norm - y0) / span, 0.0), 1.0)
        return 0.75 + 0.5 * t  # 천장 안쪽(먼 곳)은 작게, 시야 앞쪽(가까운 곳)은 크게

    return scaler


def combine_masks(mask_paths: list[str]) -> Image.Image:
    """여러 마스크의 흰 영역을 하나로 합친다 (벽 + 인식된 문짝/장들을 한 번의
    인페인팅 호출로 함께 시공된 모습으로 그리기 위함). 크기가 다른 마스크는
    첫 번째 마스크 크기에 맞춰 리사이즈한다."""
    if not mask_paths:
        raise ValueError("합칠 마스크가 없습니다.")

    base = Image.open(mask_paths[0]).convert("L")
    combined = base.copy()
    for path in mask_paths[1:]:
        mask = Image.open(path).convert("L")
        if mask.size != combined.size:
            mask = mask.resize(combined.size, Image.NEAREST)
        combined = ImageChops.lighter(combined, mask)
    return combined
