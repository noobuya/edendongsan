"""블로그 목록 맨 앞에 뜨는 "눈에 띄는" 썸네일 — 유튜브 썸네일처럼 "누르고 싶게" 만든다.

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

[왜 — 2026-11-05 재작업 "사진을 이상하게 만들어놨다 / 눌러보고 싶게 하는 썸네일"]
사진 한 장을 그대로 ImageOps.fit(가운데를 꽉 차게 자르는 방식)으로 4:3에 욱여넣기만
했더니 두 가지 문제가 생겼다. (1) 세로로 좁고 긴 사진(문짝 등)은 중앙 확대 크롭이
아무 맥락 없는 밋밋한 벽 한 칸만 남기고 다 잘라냈다. (2) 사진 한 장만으로는 "무엇이
바뀌었는지" 와닿지 않는다 — 이 블로그의 본질은 "시공 전후 변화"인데 썸네일은 그
대비를 전혀 안 썼다.
해결: 시공 전(before, 실제 업로드 사진) / 시공 후(after, AI 사진) 두 장을 구할 수
있으면 화면을 반으로 갈라 나란히 보여준다(BEFORE/AFTER 배지 포함) — 유튜브·인스타
리모델링 콘텐츠에서 가장 흔히 쓰는, 그 자체로 "호기심을 유발하는" 구도다. 한 장만
있을 때는(사진으로 블로그 만들기 등) 사진을 억지로 잘라내지 않고(ImageOps.contain)
같은 사진을 확대·블러한 배경으로 빈 자리를 채워, 어떤 비율의 사진이 와도 내용이
잘려 나가지 않는다.
"""
import re

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from app.services.blog_video import _font

# 블로그 목록 카드의 aspect-[4/3](frontend/app/blog/page.tsx)과 맞춘다.
W, H = 1200, 900
HALF_W = W // 2
# 앱 전체에서 쓰는 브랜드 인디고 — AFTER 배지·구분선에 쓴다.
ACCENT = (79, 70, 229)
BEFORE_BADGE = (28, 34, 43)

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


def _load_photo(path: str) -> Image.Image:
    with Image.open(path) as src:
        return ImageOps.exif_transpose(src).convert("RGB")


def _punch(photo: Image.Image) -> Image.Image:
    """채도·대비를 살짝 올려 유튜브 썸네일처럼 더 쨍하게 보이게 한다 — 원본을
    훼손하지 않을 정도로만(과하면 피부톤·벽지색이 부자연스러워진다)."""
    photo = ImageEnhance.Color(photo).enhance(1.15)
    return ImageEnhance.Contrast(photo).enhance(1.06)


def _badge(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, bg: tuple[int, int, int]) -> None:
    font = _font(30)
    pad_x, pad_y = 18, 10
    tw = draw.textlength(text, font=font)
    ascent, descent = font.getmetrics()
    th = ascent + descent
    draw.rounded_rectangle([x, y, x + tw + pad_x * 2, y + th + pad_y * 2], radius=10, fill=bg)
    draw.text((x + pad_x, y + pad_y), text, font=font, fill=(255, 255, 255))


def _split_before_after(before: Image.Image, after: Image.Image) -> Image.Image:
    """화면을 반으로 갈라 시공 전/후를 나란히 보여준다 — 그 자체로 "무엇이 바뀌었는지"
    궁금하게 만드는, 리모델링 콘텐츠에서 가장 흔한 구도다. 각 반쪽은 꽉 채워 자른다
    (ImageOps.fit) — 반쪽 하나의 밋밋함은 "전/후 대비"라는 맥락이 바로 옆에서 채워
    주므로, 사진 한 장만 쓸 때처럼 억지로 전체를 다 보여줄 필요가 없다."""
    left = ImageOps.fit(before, (HALF_W, H), Image.LANCZOS)
    right = ImageOps.fit(after, (W - HALF_W, H), Image.LANCZOS)
    base = Image.new("RGB", (W, H))
    base.paste(left, (0, 0))
    base.paste(right, (HALF_W, 0))

    draw = ImageDraw.Draw(base)
    divider = 6
    draw.rectangle([HALF_W - divider // 2, 0, HALF_W + divider // 2, H], fill=(255, 255, 255))
    _badge(draw, 24, 24, "BEFORE", BEFORE_BADGE)
    _badge(draw, HALF_W + 24, 24, "AFTER", ACCENT)
    return base


def _single_photo(photo: Image.Image) -> Image.Image:
    """전/후 짝을 구하지 못했을 때(사진으로 블로그 만들기 등) 사진 한 장으로 채운다.
    예전엔 ImageOps.fit으로 무조건 꽉 채워 잘랐는데, 세로로 좁고 긴 사진은 중앙만
    확대돼 맥락 없는 밋밋한 한 칸만 남는 사고가 있었다(2026-11-05 "사진을 이상하게
    만들어놨다"). 대신 사진 전체가 하나도 안 잘리게 맞추고(contain), 빈 자리는 같은
    사진을 확대·블러·어둡게 한 배경으로 채운다 — 어떤 비율이 와도 내용이 잘려
    나가지 않고, 빈 자리도 같은 사진이라 어색하지 않다."""
    bg = ImageOps.fit(photo, (W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(30))
    bg = ImageEnhance.Brightness(bg).enhance(0.5)
    fg = ImageOps.contain(photo, (W, H), Image.LANCZOS)
    base = bg.copy()
    base.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2))
    return base


def make_blog_thumbnail(after_path: str, title: str, out_path: str, before_path: str | None = None) -> str:
    after = _punch(_load_photo(after_path))
    before = _punch(_load_photo(before_path)) if before_path else None

    # before_path가 after_path와 같은 파일이면(드묾 — 폴백이 겹친 경우) 전/후 대비의
    # 의미가 없으니 한 장 모드로 둔다.
    if before is not None and before_path != after_path:
        base = _split_before_after(before, after)
    else:
        base = _single_photo(after)

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
