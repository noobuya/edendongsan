"""네이버 블로그에 넣을 업체 배너 이미지(PNG).

[왜 — 2026-11-03 "앱 블로그에 있는 대한인테리어 로고가 네이버 블로그에는 안 나온다"]
앱 블로그의 상호 표시(BusinessBanner)와 전화 상담 배너(CallBanner)는 이미지가 아니라
화면에 그리는 요소라 네이버로 복사되지 않는다. 같은 모양을 이미지로 만들어 네이버
옮기기 순서표의 맨 위(상단 배너)와 맨 아래(상담 배너)에 넣는다. 상호·전화번호는
business_info의 고정값만 쓴다(블로그 서명과 같은 원칙).
"""
from PIL import Image, ImageDraw

from app.business_info import BUSINESS_NAME, BUSINESS_PHONE, BUSINESS_SERVICE_AREA
from app.services.blog_video import _font

W = 1200


def _gradient(h: int) -> Image.Image:
    # CallBanner의 slate-900 → slate-800 그라데이션과 같은 색
    top, bottom = (15, 23, 42), (30, 41, 59)
    img = Image.new("RGB", (W, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def _center(d: ImageDraw.ImageDraw, y: int, text: str, size: int, color: tuple) -> int:
    font = _font(size)
    tw = d.textlength(text, font=font)
    x = (W - tw) / 2
    d.text((x, y), text, font=font, fill=color)
    return int(x)


def make_brand_banner(variant: str, out_path: str) -> str:
    # 전화 표시는 글꼴에 있는 ☎ 기호를 쓴다(직접 그린 도형은 "금지" 표시처럼 보였다).
    if variant == "bottom":
        h = 440
        img = _gradient(h)
        d = ImageDraw.Draw(img)
        _center(d, 46, "사진 한 장만 보내 주세요 · 무료 견적 상담", 40, (203, 213, 225))
        _center(d, 112, BUSINESS_NAME, 92, (255, 255, 255))
        _center(d, 246, f"☎ {BUSINESS_PHONE}", 84, (147, 197, 253))
        _center(d, 362, BUSINESS_SERVICE_AREA, 34, (148, 163, 184))
    else:
        h = 320
        img = _gradient(h)
        d = ImageDraw.Draw(img)
        _center(d, 40, "인테리어 필름 · 시트지 · 리폼 전문", 36, (203, 213, 225))
        _center(d, 92, BUSINESS_NAME, 92, (255, 255, 255))
        _center(d, 238, f"☎ {BUSINESS_PHONE}   |   {BUSINESS_SERVICE_AREA}", 34, (147, 197, 253))
    img.save(out_path, "PNG", optimize=True)
    return out_path
