"""AI 가상시공 비교판(/compare) 이미지 합성.

사장님이 올린 시공전 사진 여러 장과, 외부 AI(Gemini 등)로 미리 만들어 둔
시공후 옵션 사진 여러 장을 한 장의 제안서 이미지로 붙인다. 세로 줄(열) =
부위(area), 가로 줄(행) = 단계(시공 전 → 옵션1 → 옵션2 …)인 격자(grid)로,
부위마다 옵션 개수가 달라도 된다(모자란 칸은 비워 둔다). services/blog_video.py의
전/후 "밀어 보기" 움짤과 달리 이건 AI가 미리 그려 둔 사진들을 그대로 나란히
붙이는 정적 비교판이다 — 영상은 routers/comparison.py가 이 모듈이 저장한
사진 경로를 그대로 make_compare_gif/mp4(blog_video.py)에 넘겨 따로 만든다."""
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from app import business_info
from app.config import get_settings
from app.services.blog_video import _font

CELL_W = 460
CELL_H = 320
GAP = 20
MARGIN = 44
BADGE_H = 42
BADGE_GAP = 8
CAPTION_H = 50
HEADER_H = 150
TITLE_GAP = 72
PRICE_H = 74
FOOTER_H = 90

BG = (241, 245, 249)
TEXT_DARK = (15, 23, 42)
TEXT_MUTED = (100, 116, 139)
DIVIDER = (203, 213, 225)
BEFORE_BADGE = (30, 41, 59)
PRICE_BG = (254, 243, 199)
PRICE_TEXT = (120, 53, 15)
# 옵션마다 다른 배지 색 — 옵션이 5개를 넘으면 순환해서 재사용한다.
OPTION_COLORS = [(79, 70, 229), (217, 119, 6), (5, 150, 105), (219, 39, 119), (8, 145, 178)]


@dataclass
class ComparisonOptionData:
    label: str
    caption: str
    photo_path: str


@dataclass
class ComparisonAreaData:
    label: str
    before_path: str
    options: list[ComparisonOptionData] = field(default_factory=list)


def _logo_path() -> Path | None:
    p = Path(get_settings().storage_dir) / "brand" / "logo.png"
    return p if p.exists() else None


def _photo_cell(path: str) -> Image.Image:
    with Image.open(path) as img:
        photo = ImageOps.exif_transpose(img).convert("RGB")
    return ImageOps.fit(photo, (CELL_W, CELL_H), Image.LANCZOS)


def _badge(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, text: str, bg: tuple[int, int, int]) -> None:
    font = _font(21)
    # 배지 폭(w)을 넘치면 글자 크기를 조금씩 줄인다 — 옵션 라벨이 길어도 안전하게.
    while draw.textlength(text, font=font) > w - 20 and font.size > 14:
        font = _font(font.size - 2)
    tw = draw.textlength(text, font=font)
    draw.rounded_rectangle([x, y, x + w, y + BADGE_H], radius=10, fill=bg)
    ascent, descent = font.getmetrics()
    draw.text((x + (w - tw) / 2, y + (BADGE_H - ascent - descent) / 2), text, font=font, fill=(255, 255, 255))


def _caption(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, text: str) -> None:
    if not text:
        return
    font = _font(19, bold=False)
    while draw.textlength(text, font=font) > w - 16 and len(text) > 1:
        text = text[:-1]
    draw.text((x + 4, y + 10), text, font=font, fill=TEXT_DARK)


def compose_board_image(
    title: str, areas: list[ComparisonAreaData], price_note: str, out_path: str
) -> str:
    cols = max(1, len(areas))
    max_options = max((len(a.options) for a in areas), default=0)
    row_unit_h = BADGE_H + BADGE_GAP + CELL_H + CAPTION_H + GAP

    content_w = cols * CELL_W + (cols - 1) * GAP
    W = MARGIN * 2 + content_w
    content_h = (1 + max_options) * row_unit_h
    price_h = PRICE_H if price_note else 0
    H = HEADER_H + TITLE_GAP + content_h + price_h + FOOTER_H

    base = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(base)

    # 헤더 — 업로드된 로고(있으면)와 상호명·전화번호.
    name_font = _font(42)
    phone_font = _font(23, bold=False)
    text_x = MARGIN
    logo_path = _logo_path()
    if logo_path:
        with Image.open(logo_path) as logo_img:
            logo_img = logo_img.convert("RGBA")
            logo_h = 92
            logo_w = round(logo_img.width * logo_h / logo_img.height)
            logo_img = logo_img.resize((logo_w, logo_h), Image.LANCZOS)
            base.paste(logo_img, (MARGIN, (HEADER_H - logo_h) // 2), logo_img)
        text_x = MARGIN + logo_w + 22

    name = business_info.business_name()
    ascent, descent = name_font.getmetrics()
    name_y = (HEADER_H - (ascent + descent) - 8 - (phone_font.getmetrics()[0] + phone_font.getmetrics()[1])) // 2
    draw.text((text_x, name_y), name, font=name_font, fill=TEXT_DARK)
    draw.text((text_x, name_y + ascent + descent + 8), business_info.business_phone(), font=phone_font, fill=TEXT_MUTED)
    draw.line([(MARGIN, HEADER_H), (W - MARGIN, HEADER_H)], fill=DIVIDER, width=2)

    # 제목
    title_font = _font(32)
    draw.text((MARGIN, HEADER_H + (TITLE_GAP - sum(title_font.getmetrics())) // 2), title, font=title_font, fill=TEXT_DARK)

    grid_top = HEADER_H + TITLE_GAP
    for col, area in enumerate(areas):
        x = MARGIN + col * (CELL_W + GAP)
        y = grid_top

        _badge(draw, x, y, CELL_W, "BEFORE (시공 전)", BEFORE_BADGE)
        y += BADGE_H + BADGE_GAP
        base.paste(_photo_cell(area.before_path), (x, y))
        y += CELL_H
        _caption(draw, x, y, CELL_W, area.label)
        y += CAPTION_H + GAP

        for i in range(max_options):
            if i < len(area.options):
                opt = area.options[i]
                color = OPTION_COLORS[i % len(OPTION_COLORS)]
                _badge(draw, x, y, CELL_W, f"AFTER OPTION {i + 1} ({opt.label})", color)
                y += BADGE_H + BADGE_GAP
                base.paste(_photo_cell(opt.photo_path), (x, y))
                y += CELL_H
                _caption(draw, x, y, CELL_W, opt.caption)
                y += CAPTION_H + GAP
            else:
                y += row_unit_h  # 이 부위는 옵션이 더 없음 — 빈 칸으로 건너뛴다.

    y = grid_top + content_h
    if price_note:
        price_font = _font(25)
        box_h = price_h - 14
        draw.rounded_rectangle([MARGIN, y, W - MARGIN, y + box_h], radius=12, fill=PRICE_BG)
        ascent, descent = price_font.getmetrics()
        draw.text((MARGIN + 22, y + (box_h - ascent - descent) / 2), price_note, font=price_font, fill=PRICE_TEXT)
        y += price_h

    footer_top = y + 14
    draw.line([(MARGIN, footer_top), (W - MARGIN, footer_top)], fill=DIVIDER, width=2)
    contact_font = _font(23, bold=False)
    draw.text(
        (MARGIN, footer_top + 24),
        f"직영 상담 · 무료 방문 실측 : {business_info.business_phone()}",
        font=contact_font,
        fill=TEXT_DARK,
    )

    base.save(out_path, "JPEG", quality=92)
    return out_path
