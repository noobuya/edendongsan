"""시공 전/후 현장 사진으로 블로그용 짧은 홍보 영상(MP4)을 만든다.

[왜 — 2026-11-03 사장님 요청 "사진과 큰 문구, 그리고 영상으로 압도하게"]
네이버 블로그는 영상이 있는 글을 위로 올려 주고, 일반 독자는 긴 글보다 "확 바뀌는
장면"에 반응한다. 그래서 현장 사진만으로 15~25초짜리 세로형(4:5) 영상을 자동으로
만든다: 인트로(큰 문구) → 짝마다 BEFORE → 쓸어 넘기는 전환 → AFTER → 추가 시공
사진 → 상호·전화번호 마무리.

[원칙]
- 실제 현장 사진(work_photos)만 쓴다. AI가 합성한 "시공 후 예상" 사진은 실제 시공
  결과가 아니라서, 공개 홍보 영상에 시공 결과처럼 넣지 않는다.
- 상호·전화번호는 business_info의 고정값만 쓴다(블로그 서명과 같은 원칙).
- 소리는 넣지 않는다(음원 저작권 문제 — 네이버에서 사장님이 직접 배경음을 고를 수 있다).
- ffmpeg는 시스템 설치 대신 imageio-ffmpeg가 들고 오는 실행 파일을 쓴다 — 배포
  스크립트가 requirements.txt만 설치하면 그대로 동작한다.
"""

import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from app.business_info import BUSINESS_NAME, BUSINESS_PHONE, BUSINESS_SERVICE_AREA, BUSINESS_SERVICE_AREA_SHORT

W, H = 1080, 1350  # 4:5 세로 — 휴대폰으로 네이버 블로그를 보는 독자에게 화면을 꽉 채운다
FPS = 24
MAX_PAIRS = 4
MAX_EXTRA = 4
ZOOM = 1.07  # 사진이 천천히 다가오는 정도(켄 번즈 효과)

FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_REGULAR = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
_KR_INDEX = 1  # .ttc 안에서 한국어(KR) 글꼴 순서 — JP/KR/SC/TC/HK 중 KR


def _font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size, index=_KR_INDEX)
    except OSError:
        return ImageFont.load_default()


def _static_to_path(url: str) -> str:
    # "/static/uploads/x.jpg" -> "storage/uploads/x.jpg" (main.py의 StaticFiles 마운트와 같은 규칙)
    return "storage/" + url.split("/static/", 1)[1] if "/static/" in url else url


# 사진 본체가 화면에서 차지하는 최대 비율 — 천천히 다가가는 확대(ZOOM)가 가장자리를
# 잘라도 사진 모서리(현장 사진 왼쪽 아래의 "대한인테리어필름 · 시공 전/후" 표시)가
# 화면 밖으로 나가지 않을 만큼 여백을 둔다.
FIT_MARGIN = 0.9


def _cover(img: Image.Image, scale: float = ZOOM) -> Image.Image:
    """[2026-11-03 "시공 전후 글자가 잘렸다"] 예전엔 사진을 4:5 화면에 꽉 채우려고
    가운데만 잘라 써서, 가로 사진은 양옆이 통째로 날아가며 왼쪽 아래 시공 표시가
    잘렸다. 지금은 사진 전체를 화면 안에 넣고(자르지 않음), 남는 여백은 같은 사진을
    흐리고 어둡게 깔아 채운다. 확대 여유분(scale)만큼 크게 만든다."""
    rgb = img.convert("RGB")
    size = (int(W * scale), int(H * scale))
    bg = ImageOps.fit(rgb, size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
    bg = Image.eval(bg, lambda v: int(v * 0.45))
    fg = ImageOps.contain(rgb, (int(size[0] * FIT_MARGIN), int(size[1] * FIT_MARGIN)), Image.LANCZOS)
    bg.paste(fg, ((size[0] - fg.width) // 2, (size[1] - fg.height) // 2))
    return bg


def _zoom_frame(big: Image.Image, t: float) -> Image.Image:
    """t(0~1)에 따라 가운데로 천천히 다가가는 한 프레임."""
    z = 1 + (ZOOM - 1) * t  # 1 → ZOOM
    cw, ch = big.width / z, big.height / z
    left, top = (big.width - cw) / 2, (big.height - ch) / 2
    return big.resize((W, H), Image.BILINEAR, box=(left, top, left + cw, top + ch))


def _text_layer(lines: list[tuple[str, int, str]], y_center: int, band: bool = False) -> Image.Image:
    """큰 문구 레이어(RGBA). lines = [(글자, 크기, 색)]. band=True면 뒤에 반투명 띠를 깐다."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    fonts = [_font(size) for _, size, _ in lines]
    heights = [f.getbbox(text)[3] - f.getbbox(text)[1] for (text, _, _), f in zip(lines, fonts)]
    gap = 22
    total = sum(heights) + gap * (len(lines) - 1)
    y = y_center - total // 2
    if band:
        draw.rectangle((0, y - 50, W, y + total + 50), fill=(0, 0, 0, 150))
    for (text, size, color), font, h in zip(lines, fonts, heights):
        width = draw.textlength(text, font=font)
        x = (W - width) / 2
        top = y - font.getbbox(text)[1]
        draw.text((x, top), text, font=font, fill=color, stroke_width=max(2, size // 18), stroke_fill=(0, 0, 0, 220))
        y += h + gap
    return layer


def _label(text: str, sub: str, color: tuple[int, int, int]) -> Image.Image:
    """화면 위쪽 큰 라벨(BEFORE / AFTER)."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    big, small = _font(120), _font(50)
    draw.rectangle((0, 0, W, 250), fill=(0, 0, 0, 120))
    tw = draw.textlength(text, font=big)
    draw.text(((W - tw) / 2, 18), text, font=big, fill=color, stroke_width=5, stroke_fill=(0, 0, 0, 230))
    sw = draw.textlength(sub, font=small)
    draw.text(((W - sw) / 2, 170), sub, font=small, fill=(255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0, 230))
    return layer


def _compose(frame: Image.Image, overlay: Image.Image | None, fade: float = 1.0) -> bytes:
    out = frame.convert("RGBA")
    if overlay is not None:
        out = Image.alpha_composite(out, overlay)
    arr = np.asarray(out.convert("RGB"), dtype=np.uint8)
    if fade < 1.0:
        arr = (arr.astype(np.float32) * fade).astype(np.uint8)
    return arr.tobytes()


def make_blog_video(quote: dict, out_path: str) -> str:
    photos = quote.get("work_photos", [])
    before = [p for p in photos if p.get("stage") == "before"]
    after = [p for p in photos if p.get("stage") == "after"]
    if not after and not before:
        raise RuntimeError("영상에 쓸 현장 사진이 없습니다. 시공 전/후 사진을 먼저 올려 주세요.")

    def load(p: dict) -> Image.Image:
        return Image.open(_static_to_path(p["url"]))

    pair_count = min(len(before), len(after), MAX_PAIRS)
    pairs = [(load(before[i]), load(after[i])) for i in range(pair_count)]
    extras = [load(p) for p in after[pair_count:][:MAX_EXTRA]]
    cover_src = (after or before)[0]
    cover = _cover(load(cover_src))

    proc = subprocess.Popen(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", out_path,
        ],
        stdin=subprocess.PIPE,
    )
    assert proc.stdin is not None

    def emit(frame: Image.Image, overlay: Image.Image | None = None, fade: float = 1.0) -> None:
        proc.stdin.write(_compose(frame, overlay, fade))

    try:
        # 1) 인트로 — 대표 사진을 흐리고 어둡게 깐 위에 큰 문구
        bg = cover.filter(ImageFilter.GaussianBlur(6))
        bg = Image.eval(bg, lambda v: int(v * 0.55))
        intro = _text_layer(
            [
                (f"{BUSINESS_SERVICE_AREA_SHORT} 인테리어 필름", 64, "#ffffff"),
                ("확 달라진 공간", 120, "#ffe066"),
                ("BEFORE → AFTER", 70, "#ffffff"),
            ],
            H // 2,
        )
        n = int(FPS * 2.4)
        for i in range(n):
            emit(_zoom_frame(bg, i / n), intro, fade=min(1.0, i / (FPS * 0.4)))

        # 2) 짝마다 BEFORE → 쓸어 넘기는 전환 → AFTER
        before_label = _label("BEFORE", "시공 전", (255, 255, 255))
        after_label = _label("AFTER", "시공 후", (255, 224, 102))
        for b_img, a_img in pairs:
            b_big, a_big = _cover(b_img), _cover(a_img)
            hold_b, wipe, hold_a = int(FPS * 1.8), int(FPS * 0.9), int(FPS * 2.4)
            total = hold_b + wipe + hold_a
            for i in range(hold_b):
                emit(_zoom_frame(b_big, i / total), before_label)
            for i in range(wipe):
                t = (hold_b + i) / total
                fb, fa = _zoom_frame(b_big, t), _zoom_frame(a_big, t)
                x = int(W * (i + 1) / wipe)
                frame = fb.copy()
                frame.paste(fa.crop((0, 0, x, H)), (0, 0))
                ImageDraw.Draw(frame).rectangle((x - 4, 0, x + 4, H), fill=(255, 255, 255))
                emit(frame, after_label if i > wipe // 2 else before_label)
            for i in range(hold_a):
                emit(_zoom_frame(a_big, (hold_b + wipe + i) / total), after_label)

        # 3) 추가 시공 사진
        if extras:
            # 글자띠는 위쪽에 — 아래쪽엔 현장 사진의 시공 표시가 있어 가리면 안 된다.
            more = _text_layer([("시공 완료 현장", 70, "#ffffff")], 130, band=True)
            for img in extras:
                big = _cover(img)
                n = int(FPS * 1.7)
                for i in range(n):
                    emit(_zoom_frame(big, i / n), more)

        # 4) 마무리 — 상호·전화번호(고정값)
        dark = Image.eval(cover.filter(ImageFilter.GaussianBlur(10)), lambda v: int(v * 0.35))
        outro = _text_layer(
            [
                (BUSINESS_NAME, 92, "#ffffff"),
                (BUSINESS_PHONE, 104, "#ffe066"),
                ("사진 한 장으로 무료 견적 상담", 54, "#ffffff"),
                (BUSINESS_SERVICE_AREA, 40, "#dddddd"),
            ],
            H // 2,
        )
        n = int(FPS * 3.0)
        for i in range(n):
            emit(_zoom_frame(dark, i / n), outro, fade=min(1.0, (n - i) / (FPS * 0.5)))
    finally:
        proc.stdin.close()
        code = proc.wait()
    if code != 0 or not Path(out_path).exists():
        raise RuntimeError("영상 인코딩에 실패했습니다.")
    return out_path


def transcode_uploaded_video(src_path: str, out_path: str) -> str:
    """사장님이 올린 영상(휴대폰 .mov/HEVC 등)을 어느 브라우저·네이버에서나 재생되는
    H.264 MP4로 바꾼다. 긴 변은 1280px로 줄여 용량을 낮추고, 소리는 그대로 둔다
    (사장님이 직접 찍은 현장 영상이라 저작권 문제가 없다)."""
    scale = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'"
    result = subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", src_path,
            "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out_path,
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0 or not Path(out_path).exists():
        raise RuntimeError(f"영상 변환에 실패했습니다: {result.stderr[-300:]}")
    return out_path


# ── 시공 전/후 "밀어 보기" 움짤(GIF) ───────────────────────────────────────────
# [2026-11-03 "가운데 선을 좌우로 밀어서 보는 건 네이버에 안 들어간다"]
# 앱 블로그의 비교 슬라이더는 손으로 끄는 웹 기능이라 네이버 블로그(스크립트 금지)에는
# 넣을 수 없다. 대신 선이 저절로 좌우로 오가며 시공 전→후를 보여 주는 GIF를 만든다 —
# 네이버는 GIF를 움직이는 사진으로 그대로 보여 준다. 용량을 줄이려고 가로 640px,
# 공통 팔레트 하나로 만든다.
GIF_WIDTH = 640
GIF_FPS = 15


def make_compare_gif(before_path: str, after_path: str, out_path: str) -> str:
    after = ImageOps.exif_transpose(Image.open(after_path)).convert("RGB")
    before = ImageOps.exif_transpose(Image.open(before_path)).convert("RGB")
    w = GIF_WIDTH
    h = max(1, round(after.height * w / after.width))
    h = min(h, round(w * 1.4))  # 아주 긴 세로 사진은 너무 커지지 않게
    box = (w, h)

    def fit(img: Image.Image) -> Image.Image:
        canvas = Image.new("RGB", box, (15, 23, 42))
        inner = ImageOps.contain(img, box, Image.LANCZOS)
        canvas.paste(inner, ((w - inner.width) // 2, (h - inner.height) // 2))
        return canvas

    b, a = fit(before), fit(after)
    font = _font(max(18, w // 22))

    def label(draw: ImageDraw.ImageDraw, text: str, x: int, fill: tuple, ink: tuple) -> None:
        tw = draw.textlength(text, font=font)
        pad = 8
        bx = x if x >= 0 else w + x - int(tw) - pad * 2
        draw.rounded_rectangle((bx, 10, bx + tw + pad * 2, 10 + font.size + pad * 1.6), radius=8, fill=fill)
        draw.text((bx + pad, 10 + pad * 0.6), text, font=font, fill=ink)

    # 선 위치(0~1): 오른쪽 끝에서 잠깐 멈춤(화면 대부분이 시공 전) → 왼쪽으로 쓸며 시공 후가
    # 드러남 → 멈춤 → 되돌아감
    positions: list[float] = []
    hold = int(GIF_FPS * 0.6)
    move = int(GIF_FPS * 1.4)
    positions += [0.92] * hold
    positions += [0.92 - 0.84 * (0.5 - 0.5 * np.cos(np.pi * i / move)) for i in range(1, move + 1)]
    positions += [0.08] * hold
    positions += [0.08 + 0.84 * (0.5 - 0.5 * np.cos(np.pi * i / move)) for i in range(1, move + 1)]

    palette_src = Image.new("RGB", (w * 2, h))
    palette_src.paste(b, (0, 0))
    palette_src.paste(a, (w, 0))
    palette = palette_src.quantize(colors=255, method=Image.Quantize.MEDIANCUT)

    frames = []
    for pos in positions:
        x = int(w * pos)
        frame = b.copy()  # 앱 슬라이더와 같게: 선 왼쪽은 시공 전, 오른쪽은 시공 후
        frame.paste(a.crop((x, 0, w, h)), (x, 0))
        d = ImageDraw.Draw(frame)
        d.rectangle((x - 2, 0, x + 2, h), fill=(255, 255, 255))
        r = max(14, w // 28)
        d.ellipse((x - r, h // 2 - r, x + r, h // 2 + r), fill=(255, 255, 255), outline=(15, 23, 42), width=2)
        d.polygon([(x - r // 2, h // 2), (x - 3, h // 2 - r // 2), (x - 3, h // 2 + r // 2)], fill=(15, 23, 42))
        d.polygon([(x + r // 2, h // 2), (x + 3, h // 2 - r // 2), (x + 3, h // 2 + r // 2)], fill=(15, 23, 42))
        label(d, "BEFORE 시공 전", 10, (0, 0, 0), (255, 255, 255))
        label(d, "AFTER 시공 후", -10, (251, 191, 36), (15, 23, 42))
        frames.append(frame.quantize(palette=palette, dither=Image.Dither.NONE))

    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=int(1000 / GIF_FPS),
        loop=0,
        optimize=True,
        disposal=1,
    )
    return out_path
