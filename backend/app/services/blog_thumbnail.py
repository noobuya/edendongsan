"""블로그 목록 맨 앞에 뜨는 "눈에 띄는" 썸네일 — AI 시공 사진 위에 큰 제목을 올린다.

[왜 — 2026-11-04 사장님 요청 "대표사진을 이목을 끌 수 있는 문자와 AI사진으로 썸네일로"]
블로그 목록(frontend/app/blog/page.tsx)은 지금까지 시공 사진을 글자 없이 그대로
보여줬다 — 유튜브 썸네일처럼 "무슨 내용인지 한눈에, 클릭하고 싶게" 만드는 장치가
없었다. 이 모듈이 블로그 글의 제목(이미 "일반인이 클릭하고 싶어지는 짧고 강한
문장"으로 쓰도록 되어 있다 — blog_writer.py의 PROMPT_TEMPLATE 참고)을 그대로 가져와,
AI가 그린 시공 후 사진 위에 큰 글씨로 얹는다.

본문(blog/post/page.tsx)의 대표 사진은 "실제 시공 결과"만 쓰도록 일부러 AI 합성
사진을 뺀다(신뢰도 — 그 페이지의 coverUrl 주석 참고). 이 썸네일은 반대로 AI 사진을
쓴다 — 목록에서는 설득력보다 눈에 띄는 완성도가 우선이고(사장님이 명시적으로
"AI사진으로"라고 요청), 글을 눌러 들어간 본문에서는 여전히 실제 사진이 증빙 역할을
한다. 서로 다른 화면, 서로 다른 목적이라 원칙이 갈려도 모순이 아니다.
"""
import re

from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.services.blog_video import _font

# 블로그 목록 카드의 aspect-[4/3](frontend/app/blog/page.tsx)과 맞춘다.
W, H = 1200, 900

# 제목 앞에 붙는 "[대구 인테리어 필름]" 같은 SEO용 고정 접두사는 썸네일에서는 빼고
# 뒤의 핵심 문장만 큼직하게 보여준다 — 글자 수를 줄여야 더 크고 읽기 쉽게 들어간다.
_PREFIX_RE = re.compile(r"^\[[^\]]+\]\s*")
# 제목에 이모지가 섞여 있으면(사진으로 블로그 만들기에서 사장님이 직접 적은 제목 등)
# 한국어 굵은 글꼴에 이모지 글리프가 없어 빈 네모(tofu)로 깨져 보인다 — 미리 빼고
# 남은 공백은 한 칸으로 정리한다.
_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\U00002B00-\U00002BFF️]+"
)

_MAX_LINES = 3
_SIDE_MARGIN = 72
_BOTTOM_MARGIN = 64
_START_SIZE = 96
_MIN_SIZE = 52


def _headline_text(title: str) -> str:
    stripped = _PREFIX_RE.sub("", title).strip() or title.strip()
    cleaned = re.sub(r"\s+", " ", _EMOJI_RE.sub("", stripped)).strip()
    return cleaned or stripped


def _wrap_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """어절(공백) 단위로 줄바꿈한다. 공백이 거의 없는 문장(드묾)은 글자 단위로 자른다."""
    words = text.split(" ")
    char_mode = len(words) <= 1
    units = list(text) if char_mode else words
    sep = "" if char_mode else " "

    lines: list[str] = []
    current = ""
    for unit in units:
        candidate = unit if not current else f"{current}{sep}{unit}"
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = unit
    if current:
        lines.append(current)
    return lines


def _fit_lines(draw: ImageDraw.ImageDraw, text: str, max_width: int) -> tuple[list[str], ImageFont.FreeTypeFont]:
    """가로 폭 안에서 줄 수가 _MAX_LINES 이하가 될 때까지 글자 크기를 줄여 나간다."""
    size = _START_SIZE
    while size >= _MIN_SIZE:
        font = _font(size)
        lines = _wrap_lines(draw, text, font, max_width)
        if len(lines) <= _MAX_LINES:
            return lines, font
        size -= 6
    font = _font(_MIN_SIZE)
    return _wrap_lines(draw, text, font, max_width)[:_MAX_LINES], font


def make_blog_thumbnail(source_image_path: str, title: str, out_path: str) -> str:
    with Image.open(source_image_path) as src:
        photo = ImageOps.exif_transpose(src).convert("RGB")
    base = ImageOps.fit(photo, (W, H), Image.LANCZOS)

    # 사진이 어떤 색이든 글자가 항상 읽히도록, 아래쪽을 검게 깔아 그라데이션으로 올린다.
    gradient = Image.new("L", (1, H))
    for y in range(H):
        t = max(0.0, (y - H * 0.32) / (H * 0.68))
        gradient.putpixel((0, y), int(200 * t))
    gradient = gradient.resize((W, H))
    shade = Image.new("RGB", (W, H), (8, 10, 14))
    base = Image.composite(shade, base, gradient)

    draw = ImageDraw.Draw(base)
    max_width = W - _SIDE_MARGIN * 2
    lines, font = _fit_lines(draw, _headline_text(title), max_width)

    ascent, descent = font.getmetrics()
    line_height = ascent + descent
    gap = int(line_height * 0.3)
    total_h = len(lines) * line_height + (len(lines) - 1) * gap
    y = H - _BOTTOM_MARGIN - total_h

    for line in lines:
        draw.text(
            (_SIDE_MARGIN, y),
            line,
            font=font,
            fill=(255, 255, 255),
            stroke_width=max(3, font.size // 16),
            stroke_fill=(0, 0, 0, 235),
        )
        y += line_height + gap

    base.save(out_path, "JPEG", quality=88, optimize=True)
    return out_path
