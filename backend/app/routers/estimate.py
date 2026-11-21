"""고객이 채팅으로 보낸 현장 사진을 보고 즉석 견적(대략적인 품목·가격 범위)을
추정한다. jobs.py의 정밀 AI 견적(AR 실측·세그멘테이션 기반, 수십 초~분 단위)과는
별개로, 당근·숨고·블로그 채팅 응대 중에 빠르게 감을 잡는 용도라 사진만 보고
한 번의 Gemini 호출로 끝낸다 — 정확한 금액은 실측 후 확정됨을 전제로 한다.
"""
import json
from io import BytesIO

from fastapi import APIRouter, File, HTTPException, UploadFile
from google import genai
from google.genai import types
from PIL import Image
from pydantic import BaseModel

from app.config import get_settings
from app.services.timeouts import run_gemini_with_retry

router = APIRouter(prefix="/api/estimate", tags=["estimate"])

GEMINI_MODEL = "gemini-flash-latest"
TIMEOUT_S = 30

# frontend/app/chat-quote/page.tsx의 PRESET_ITEMS와 같은 값으로 맞춰둔다 —
# AI 추정이 사장님이 실제로 쓰는 단가 감각과 어긋나지 않도록 참고 기준으로 준다.
# [가격 정정 — 2026-11-22] 고객에게 채팅으로 먼저 나가는 "낮은 미끼가"라
# 방문 실측 후 확정하는 본래 가격보다 낮게 잡는다(사장님 지시).
REFERENCE_PRICES = """- 30평대 싱크대 상·하부장 + 냉장고장: 50만 원
- 싱크대 + 냉장고장 + 아일랜드 식탁: 70만 원
- 방문 및 문틀 필름 시공 (민자): 15만 원 (짝당)
- 방문 및 문틀 필름 시공 (알판): 18만 원 (짝당)
- 붙박이장 도어 필름 시공: 10만 원 (2도어 기준)
- 스테인리스 사각 싱크볼 교체 + 실리콘 마감: 25만 원
- 위 목록에 없는 품목(몰딩, 신발장 등)은 비슷한 규모·난이도로 합리적으로 추정"""


class EstimateResult(BaseModel):
    item_summary: str
    total_min: int
    total_max: int
    analysis_note: str


@router.post("", response_model=EstimateResult)
async def estimate_from_photos(files: list[UploadFile] = File(...)) -> EstimateResult:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="사진 분석 기능이 설정되지 않았습니다.")

    images = []
    for f in files[:4]:
        raw = await f.read()
        try:
            images.append(Image.open(BytesIO(raw)))
        except Exception:  # noqa: BLE001 - 읽을 수 없는 파일은 건너뛴다
            continue
    if not images:
        raise HTTPException(status_code=400, detail="읽을 수 있는 사진이 없습니다.")

    prompt = (
        "사진 속 인테리어 필름 시공이 필요한 부위를 보고, 대한인테리어필름의 예상 "
        "견적을 추정하라. 참고 단가표:\n"
        f"{REFERENCE_PRICES}\n\n"
        '다음 JSON 형식으로만 답하라: {"item_summary": "문의하신 시공 품목을 한 '
        '문장으로 구체적으로", "total_min": 500000, "total_max": 600000, '
        '"analysis_note": "사진에서 확인한 현장 특이사항을 한 문장으로"} '
        "(금액은 원 단위 정수, 범위가 뚜렷하지 않으면 total_min과 total_max를 같게)"
    )

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = run_gemini_with_retry(
            client.models.generate_content,
            TIMEOUT_S,
            model=GEMINI_MODEL,
            contents=[prompt, *images],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        data = json.loads(response.text)
        return EstimateResult(**data)
    except Exception as exc:  # noqa: BLE001 - 분석 실패는 502로 알리고 프런트가 폴백한다
        raise HTTPException(status_code=502, detail=f"사진 분석에 실패했습니다: {exc}") from exc
