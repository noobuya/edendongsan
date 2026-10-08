"""시공 사진용 전자흑판(電子黒板) 워터마크.

일본 건설업계 공사사진 앱(蔵衛門 등)의 핵심 기능 — 현장명·촬영일·업체명·단계를
사진 자체에 각인해서, 사진이 나중에 바뀌거나 다른 현장 사진이 섞여 들어가도
"조작되지 않은 그 날 그 현장 사진"이라는 근거가 사진 파일 하나에 남는다. 이
앱의 현장 사진(work_photos)은 시공후기 블로그의 비포/애프터 증거 사진으로도
쓰이므로, 고객이 보는 화면의 신뢰도에 직접 영향을 준다.

업로드 시점에 한 번만 각인하고 원본은 따로 보관하지 않는다 — 나중에 떼어낼
필요가 없고(지울 이유가 없는 정보만 담는다), 오히려 떼어낼 수 없어야 전자흑판의
취지(사후 조작 방지)에 맞는다.
"""
from PIL import Image, ImageDraw, ImageFont

# Linux 서버(apt의 fonts-noto-cjk)와 Windows 개발 PC(기본 탑재 맑은 고딕) 양쪽에서
# 한글이 다 깨지지 않게, 흔히 있는 경로를 순서대로 시도한다. 전부 없으면(드문 환경)
# PIL 기본 폰트로 물러서는데, 그 폰트는 한글을 그리지 못해 네모만 찍힌다 — 그래도
# 앱이 죽거나 사진 업로드가 막히는 것보다는 낫다.
_FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "C:/Windows/Fonts/malgunbd.ttf",
    "C:/Windows/Fonts/malgun.ttf",
]

_font_cache: dict[int, ImageFont.FreeTypeFont] = {}


def _font(size: int) -> ImageFont.ImageFont:
    if size in _font_cache:
        return _font_cache[size]
    for path in _FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(path, size)
            _font_cache[size] = font
            return font
        except OSError:
            continue
    return ImageFont.load_default()


STAGE_LABELS = {"before": "시공 전", "progress": "시공 중", "after": "시공 후"}


def stamp_blackboard(image: Image.Image, business_name: str, customer_name: str, stage: str, recorded_at_label: str) -> Image.Image:
    """사진 좌측 하단에 반투명 흑판 패널을 그려 넣는다. 원본을 바꾸지 않고 복사본을 돌려준다."""
    stage_label = STAGE_LABELS.get(stage, stage)
    customer_label = customer_name.strip() or "현장명 미입력"
    lines = [f"{business_name} · {stage_label}", customer_label, recorded_at_label]

    base = image.convert("RGB")
    w, h = base.size
    # 사진 크기에 비례한 글자 크기 — 작은 썸네일에서도 읽히되, 사진을 과하게 가리지 않는다.
    font_size = max(14, round(w * 0.028))
    line_font = _font(font_size)
    pad = round(font_size * 0.7)
    line_gap = round(font_size * 0.35)

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    line_heights = []
    max_text_w = 0
    for text in lines:
        bbox = draw.textbbox((0, 0), text, font=line_font)
        line_heights.append(bbox[3] - bbox[1])
        max_text_w = max(max_text_w, bbox[2] - bbox[0])

    board_w = max_text_w + pad * 2
    board_h = sum(line_heights) + line_gap * (len(lines) - 1) + pad * 2
    board_x0, board_y0 = 0, h - board_h
    draw.rectangle([board_x0, board_y0, board_x0 + board_w, h], fill=(17, 20, 26, 176))

    y = board_y0 + pad
    for text, lh in zip(lines, line_heights):
        draw.text((board_x0 + pad, y), text, font=line_font, fill=(255, 255, 255, 235))
        y += lh + line_gap

    return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")
