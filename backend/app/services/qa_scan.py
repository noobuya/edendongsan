"""시공 마감 사진에서 들뜸·기포·이음새 벌어짐 같은 필름 시공 하자를 1차로 스캔한다.

vision_client.py의 analyze_room()과 같은 패턴(Gemini Vision에 사진 한 장을 보내
JSON으로만 받기) — 수강생 교육과 기공의 원격 검수를 돕는 참고용 1차 판정이지,
하자 보수 책임을 가르는 공식 판정이 아니다."""
import json

from google import genai
from google.genai import types
from PIL import Image

from app.config import get_settings
from app.services.timeouts import run_gemini_with_retry

QA_TIMEOUT_S = 30
GEMINI_MODEL = "gemini-flash-latest"

# Gemini 키가 없거나 호출이 실패했을 때 쓰는 기본값 — "모른다"로 명확히 표시해
# 기공이 AI 판정을 실제 검수 결과로 착각하지 않게 한다.
DEFAULT_RESULT = {
    "verdict": "unknown",
    "defects": [],
    "notes": "AI 점검을 사용할 수 없어요. 사진을 직접 확인해 주세요.",
}

PROMPT = (
    "이 사진은 인테리어 필름(시트지) 시공 마감 사진이다. 아래 하자 유형이 실제로 "
    "사진에 보이는지만 근거로 판단하라 — 안 보이면 지어내지 말고 없다고 답하라.\n"
    "확인할 하자: 들뜸(edge lifting), 기포(bubbling), 이음새 벌어짐(seam gap), "
    "오염/얼룩, 기타.\n"
    "다른 설명 없이 정확히 이 JSON 형식으로만 답하라:\n"
    '{"verdict": "pass 또는 issues_found", '
    '"defects": [{"type": "들뜸|기포|이음새 벌어짐|오염|기타", "description": "짧은 설명"}], '
    '"notes": "한 줄 종합 코멘트"}'
)


def scan_finish_quality(image_path: str) -> dict:
    settings = get_settings()
    if not settings.gemini_api_key:
        return DEFAULT_RESULT
    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        image = Image.open(image_path)
        response = run_gemini_with_retry(
            client.models.generate_content,
            QA_TIMEOUT_S,
            model=GEMINI_MODEL,
            contents=[PROMPT, image],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        return json.loads(response.text)
    except Exception as exc:  # noqa: BLE001 - AI 실패는 "모른다"로만 알리고 업로드 자체는 막지 않는다
        print(f"[qa_scan] Gemini 호출 실패: {exc}")
        return DEFAULT_RESULT
