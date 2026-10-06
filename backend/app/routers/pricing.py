"""단가(공임·재료비·요율) 조회/수정 API.

앱에서 대한인테리어필름 배너를 3초간 누르면 열리는 단가 설정 화면이 쓴다. 현장 단가는
지역·시기·거래처에 따라 자주 바뀌므로, 프로그램을 다시 배포하지 않고 바로
고칠 수 있어야 한다.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import pricing_store

router = APIRouter(prefix="/api/pricing", tags=["pricing"])


class PricingField(BaseModel):
    key: str
    label: str
    group: str
    unit: str
    value: float
    default: float


class PricingResponse(BaseModel):
    fields: list[PricingField]


class PricingUpdateRequest(BaseModel):
    # {"manday_rate": 280000, "price_table.fan.unit_price": 200000} 형태
    values: dict[str, float] = Field(default_factory=dict)


@router.get("", response_model=PricingResponse)
async def get_pricing():
    return PricingResponse(fields=pricing_store.list_fields())


@router.put("", response_model=PricingResponse)
async def update_pricing(request: PricingUpdateRequest):
    for key, value in request.values.items():
        if value < 0:
            raise HTTPException(status_code=422, detail=f"'{key}' 값은 0보다 작을 수 없습니다.")
    return PricingResponse(fields=pricing_store.save_overrides(request.values))
