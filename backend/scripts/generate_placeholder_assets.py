"""로컬 구동 테스트용 플레이스홀더 에셋 생성 스크립트.

실제 서비스에서는 디자인팀이 제공하는 시트지 패턴 이미지와 조명/팬 제품 컷아웃
PNG(RGBA, 투명 배경)로 backend/assets/ 하위 파일을 교체하면 된다. 이 스크립트는
그 전까지 렌더링 파이프라인(rendering.py)이 곧바로 동작하도록 절차적으로 생성한
이미지를 assets/patterns, assets/fixtures 에 채워 넣는다.

실행: python scripts/generate_placeholder_assets.py  (backend/ 디렉토리에서)
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

BASE_DIR = Path(__file__).resolve().parent.parent
PATTERNS_DIR = BASE_DIR / "assets" / "patterns"
FIXTURES_DIR = BASE_DIR / "assets" / "fixtures"


def make_wood_pattern(base_color: tuple[int, int, int], size: int = 512) -> Image.Image:
    img = Image.new("RGB", (size, size), base_color)
    draw = ImageDraw.Draw(img)
    band_height = 20
    r, g, b = base_color
    for y in range(0, size, band_height):
        shade = (y * 37) % 40
        color = (max(r - shade, 0), max(g - shade, 0), max(b - shade // 2, 0))
        draw.rectangle([0, y, size, y + band_height - 3], fill=color)
    return img


def make_grain_pattern(base_color: tuple[int, int, int], size: int = 512) -> Image.Image:
    """단색 + 미세한 그레인 노이즈로 만든 절차적 재질 텍스처(콘크리트/차콜/그린/베이지 등)."""
    base = Image.new("RGB", (size, size), base_color)
    noise = Image.effect_noise((size, size), 22).convert("RGB")
    return Image.blend(base, noise, 0.07)


def make_downlight_icon(size: int = 256) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    margin = size * 0.15
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=(245, 245, 235, 255),
        outline=(110, 110, 110, 255),
        width=6,
    )
    inner = size * 0.32
    draw.ellipse(
        [size / 2 - inner, size / 2 - inner, size / 2 + inner, size / 2 + inner],
        fill=(255, 244, 200, 255),
    )
    return img


def make_ceiling_fan_icon(size: int = 512) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size / 2, size / 2
    blade_len = size * 0.42
    blade_width = int(size * 0.1)

    for angle_deg in (90, 210, 330):
        angle = math.radians(angle_deg)
        ex = cx + blade_len * math.cos(angle)
        ey = cy - blade_len * math.sin(angle)
        draw.line([(cx, cy), (ex, ey)], fill=(70, 70, 70, 255), width=blade_width)
        draw.ellipse(
            [ex - blade_width / 2, ey - blade_width / 2, ex + blade_width / 2, ey + blade_width / 2],
            fill=(70, 70, 70, 255),
        )

    hub_r = size * 0.07
    draw.ellipse([cx - hub_r, cy - hub_r, cx + hub_r, cy + hub_r], fill=(35, 35, 35, 255))
    return img


def main() -> None:
    PATTERNS_DIR.mkdir(parents=True, exist_ok=True)
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    # 이전 세대 패턴 파일 정리 (카탈로그가 10종 스와치 체계로 교체됨)
    for stale in ["marble-white.png", "wood-oak.png", "concrete-gray.png", "charcoal.png", "deep-green.png"]:
        (PATTERNS_DIR / stale).unlink(missing_ok=True)

    # app/catalog.py의 PATTERNS 항목(id, color_hex)과 반드시 짝이 맞아야 한다.
    make_grain_pattern((242, 241, 237)).save(PATTERNS_DIR / "matte-white.png")
    make_grain_pattern((245, 238, 220)).save(PATTERNS_DIR / "cream-white.png")
    make_grain_pattern((199, 203, 206)).save(PATTERNS_DIR / "light-gray.png")
    make_grain_pattern((85, 88, 92)).save(PATTERNS_DIR / "dark-gray.png")
    make_grain_pattern((43, 43, 46)).save(PATTERNS_DIR / "matte-black.png")
    make_wood_pattern((176, 139, 90)).save(PATTERNS_DIR / "oak-wood.png")
    make_wood_pattern((92, 58, 40)).save(PATTERNS_DIR / "walnut-wood.png")
    make_grain_pattern((31, 42, 68)).save(PATTERNS_DIR / "deep-navy.png")
    make_grain_pattern((107, 107, 58)).save(PATTERNS_DIR / "olive-green.png")
    make_grain_pattern((217, 199, 172)).save(PATTERNS_DIR / "warm-beige.png")

    make_downlight_icon().save(FIXTURES_DIR / "downlight_basic.png")
    make_ceiling_fan_icon().save(FIXTURES_DIR / "ceiling_fan_basic.png")

    print("생성 완료:")
    for path in [*PATTERNS_DIR.iterdir(), *FIXTURES_DIR.iterdir()]:
        print(" -", path)


if __name__ == "__main__":
    main()
