"""날씨 연동 들뜸·기포 하자 방지 주의보 — 공개 조회 전용(민감 정보 없음).

기공·조공 양쪽 화면 상단에 띄우는 참고용 경고라 인증을 요구하지 않는다."""
from fastapi import APIRouter

from app.schemas import WeatherAdvisoryResponse
from app.services.weather_advisory import DEFAULT_LOCATION, build_advisory, fetch_weather

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("/advisory", response_model=WeatherAdvisoryResponse)
def get_weather_advisory(location: str = DEFAULT_LOCATION) -> WeatherAdvisoryResponse:
    weather = fetch_weather(location)
    if weather is None:
        return WeatherAdvisoryResponse(available=False, location=location)
    advisory = build_advisory(weather["temp_c"], weather["humidity"], weather["precip_mm"])
    return WeatherAdvisoryResponse(
        available=True,
        location=location,
        temp_c=weather["temp_c"],
        humidity=weather["humidity"],
        description=weather["description"],
        level=advisory["level"],
        message=advisory["message"],
    )
