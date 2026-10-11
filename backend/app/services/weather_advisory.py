"""현장 주소의 당일 날씨로 필름 들뜸·기포 하자를 미리 경고한다.

필름은 온습도에 민감해서, 습하거나 비 오는 날 평소처럼 프라이머를 바르고
덮으면 며칠 뒤 기포·들뜸이 생기기 쉽다 — 이 서비스는 그 경고를 현장에 미리
띄우는 참고용 조언이지, 공식 기상 예보가 아니다.

날씨 소스는 wttr.in(API 키 없이 바로 쓸 수 있는 무료 서비스)을 쓴다. 더 정확한
공식 데이터가 필요해지면 기상청(data.go.kr) API로 바꿀 수 있게 이 함수 하나로
소스를 감싸 둔다."""
import httpx

WEATHER_TIMEOUT_S = 6.0
DEFAULT_LOCATION = "Daegu"

# SiteConditionsCard.tsx(components/SiteConditionsCard.tsx)의 적정 시공 온도
# 기준과 맞춘다 — 같은 "하자 방지" 판정 기준을 수동 입력 화면과 날씨 자동 조회
# 화면이 서로 다르게 말하면 혼란스럽다.
MIN_TEMP_C = 15
MAX_TEMP_C = 25
HUMIDITY_WARNING_PERCENT = 70


def fetch_weather(location: str = DEFAULT_LOCATION) -> dict | None:
    """wttr.in에서 현재 기온·습도·강수량·날씨 설명을 받아온다. 실패하면 None —
    호출하는 쪽이 "날씨 정보 없음"으로 조용히 넘어간다(현장 일정 자체를 막으면 안 됨)."""
    try:
        response = httpx.get(
            f"https://wttr.in/{location}",
            params={"format": "j1"},
            timeout=WEATHER_TIMEOUT_S,
            headers={"User-Agent": "curl/8"},  # wttr.in은 User-Agent로 응답 포맷을 가른다
        )
        response.raise_for_status()
        data = response.json()
        current = data["current_condition"][0]
        return {
            "temp_c": int(current["temp_C"]),
            "humidity": int(current["humidity"]),
            "precip_mm": float(current["precipMM"]),
            "description": current.get("weatherDesc", [{}])[0].get("value", ""),
        }
    except (httpx.HTTPError, KeyError, ValueError, IndexError, TypeError):
        return None


def build_advisory(temp_c: int, humidity: int, precip_mm: float) -> dict:
    """온습도·강수 기준으로 하자 주의보 문구를 만든다.
    level: "warning"(들뜸·기포 위험 높음) | "caution"(평소보다 주의) | "ok"(평소대로)."""
    is_raining = precip_mm > 0
    is_humid = humidity >= HUMIDITY_WARNING_PERCENT
    is_cold = temp_c < MIN_TEMP_C
    is_hot = temp_c > MAX_TEMP_C

    if is_raining or is_humid:
        reason = "우천" if is_raining else "고습도"
        return {
            "level": "warning",
            "message": (
                f"현재 습도 {humidity}%({reason}) — 들뜸·기포 하자 위험이 높아요. "
                "프라이머 건조 시간을 평소 2배로 잡고, 굴곡부는 반드시 열풍기를 고온으로 써 주세요."
            ),
        }
    if is_cold or is_hot:
        direction = "낮아" if is_cold else "높아"
        return {
            "level": "caution",
            "message": (
                f"현재 기온 {temp_c}℃ — 적정 시공 온도({MIN_TEMP_C}~{MAX_TEMP_C}℃)보다 {direction}요. "
                "접착력이 떨어질 수 있으니 시공 전 바탕면 온도를 확인해 주세요."
            ),
        }
    return {"level": "ok", "message": f"현재 기온 {temp_c}℃·습도 {humidity}% — 시공하기 좋은 날씨예요."}
