"""실물 견본 책자(현대보닥/KCC/영림 샘플북) 쪽 단위 스캔.

[왜 — 2026-11-10 사장님 요청 "책자가 100장짜리, 업체별로 넣으면 300쪽"]
catalog.PATTERNS는 손으로 고른 24개뿐이라 이 규모를 감당 못 한다. 그래서
catalog.py와 완전히 별개로, 스캔할 때마다 자동으로 늘어나는 실물 견본 DB를
둔다(storage/swatch_scan.json). 쪽 사진 한 장을 올리면 이 앱이 이미 영역
인식에 쓰고 있는 것과 같은 방식(services/segmentation.py의
_detect_regions_with_boxes — Gemini Vision에게 상자 좌표를 0~1000 정규화로
직접 묻는 프롬프팅)으로 그 쪽 안의 품번 칩들을 전부 찾아 각각 잘라내고,
칩 옆에 인쇄된 코드·이름 글자를 읽어 DB에 추가한다.

100% 정확하진 않다(글자가 작거나 빛이 반사되면 코드를 못 읽을 수 있다) —
그래서 모든 항목은 status="needs_review"(코드를 못 읽었을 때)로 시작해,
사장님이 나중에 /admin/swatch-scan에서 훑어보며 고치거나 지울 수 있게 한다."""
import io
import json
import re
import time
import uuid
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image

from app.config import get_settings
from app.services.timeouts import run_gemini_with_retry

GEMINI_MODEL = "gemini-flash-latest"
SCAN_TIMEOUT_S = 60

# 브랜드 이름 -> 파일/id에 쓰는 영문 slug. 목록에 없는 브랜드는 코드에서
# 영문·숫자만 추출해 임시 slug를 만든다(_slugify 참고) — 새 브랜드가 와도
# 막히지 않게 한다.
BRAND_SLUGS = {
    "현대보닥": "bodaq",
    "KCC": "kcc",
    "영림": "yeonglim",
}


def _db_path() -> Path:
    return Path(get_settings().storage_dir) / "swatch_scan.json"


def _photos_dir() -> Path:
    d = Path(get_settings().storage_dir) / "swatch_scan_photos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load() -> list[dict]:
    p = _db_path()
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save(entries: list[dict]) -> None:
    p = _db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


def list_entries() -> list[dict]:
    return _load()


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _detect_swatches_on_page(image: Image.Image, brand: str, api_key: str) -> list[dict]:
    """한 쪽 사진에서 품번 칩들을 찾아 [{code, name, box_2d}] 리스트로 돌려준다.
    (box_2d 규약은 segmentation.py와 동일 — [ymin, xmin, ymax, xmax], 0~1000 정규화.)"""
    client = genai.Client(api_key=api_key)
    prompt = (
        f"이 사진은 인테리어 필름 제조사({brand}) 견본 샘플북의 한 쪽이다. "
        "쪽 위에 붙어 있는 색상/재질 견본 칩을 전부 찾아라. 각 칩 옆이나 아래에 "
        "보통 제품 코드(알파벳+숫자, 예: S261, W015, PTS21)와 색상/재질 이름이 "
        "인쇄돼 있다. 그 글자를 읽어 코드와 이름을 각각 적어라. 코드가 안 보이거나 "
        "확신이 없으면 code를 빈 문자열로 둬라(억지로 만들어내지 말 것). "
        "칩 자체(견본 색이 보이는 사각형 영역)만 상자로 잡아라 — 글자 부분은 제외. "
        '다음 JSON 형식으로만 답하라: {"swatches": [{"code": "S261", "name": "딥 슬레이트", '
        '"box_2d": [ymin, xmin, ymax, xmax]}]} 좌표는 이미지 기준 0~1000 정규화 정수다.'
    )
    response = run_gemini_with_retry(
        client.models.generate_content,
        SCAN_TIMEOUT_S,
        model=GEMINI_MODEL,
        contents=[prompt, image],
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )
    parsed = json.loads(response.text)
    return parsed.get("swatches", []) if isinstance(parsed, dict) else []


def scan_page(image_bytes: bytes, brand: str, source_label: str) -> list[dict]:
    """쪽 사진 한 장(바이트)을 스캔해 DB에 새 항목을 추가하고, 이번에 새로 찾은
    항목들을 돌려준다. 호출자(라우터)가 여러 쪽을 순서대로 이 함수에 넘긴다."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("Gemini API 키가 설정되어 있지 않습니다.")

    base = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = base.size

    detections = _detect_swatches_on_page(base, brand, settings.gemini_api_key)
    if not detections:
        return []

    entries = _load()
    existing_ids = {e["id"] for e in entries}
    found: list[dict] = []
    brand_slug = BRAND_SLUGS.get(brand) or _slugify(brand) or "brand"

    for det in detections:
        if not isinstance(det, dict):
            continue
        code = str(det.get("code") or "").strip()
        name = str(det.get("name") or "").strip()
        box = det.get("box_2d")
        if not isinstance(box, list) or len(box) != 4:
            continue
        try:
            ymin, xmin, ymax, xmax = (float(v) for v in box)
        except (TypeError, ValueError):
            continue

        left = max(0, int(xmin / 1000 * width))
        top = max(0, int(ymin / 1000 * height))
        right = min(width, int(xmax / 1000 * width))
        bottom = min(height, int(ymax / 1000 * height))
        if right <= left or bottom <= top:
            continue
        crop = base.crop((left, top, right, bottom))

        code_slug = _slugify(code) if code else uuid.uuid4().hex[:8]
        base_id = f"{brand_slug}-{code_slug}"
        # 같은 코드를 또 스캔했으면(중복 쪽 또는 재촬영) 덮어쓰지 않고 번호를
        # 붙여 남긴다 — 나중에 사장님이 비교해서 고를 수 있게.
        entry_id = base_id
        suffix = 1
        while entry_id in existing_ids:
            suffix += 1
            entry_id = f"{base_id}-{suffix}"

        crop.save(_photos_dir() / f"{entry_id}.jpg", "JPEG", quality=90)

        entry = {
            "id": entry_id,
            "brand": brand,
            "code": code,
            "name": name,
            "photo": f"{entry_id}.jpg",
            "source": source_label,
            "status": "needs_review" if not code else "confirmed",
            "created_at": time.time(),
        }
        entries.append(entry)
        existing_ids.add(entry_id)
        found.append(entry)

    _save(entries)
    return found


def update_entry(entry_id: str, code: str | None = None, name: str | None = None, brand: str | None = None) -> list[dict]:
    entries = _load()
    for e in entries:
        if e["id"] == entry_id:
            if code is not None:
                e["code"] = code
            if name is not None:
                e["name"] = name
            if brand is not None:
                e["brand"] = brand
            e["status"] = "confirmed"
    _save(entries)
    return entries


def delete_entry(entry_id: str) -> list[dict]:
    entries = [e for e in _load() if e["id"] != entry_id]
    _save(entries)
    photo_path = _photos_dir() / f"{entry_id}.jpg"
    if photo_path.exists():
        photo_path.unlink()
    return entries
