"""첫 화면 UI 요소의 위치·크기 API.

조회(GET)는 누구나 할 수 있다 — 그 값대로 화면을 그려야 손님 기기에도 사장님이
맞춘 배치가 똑같이 보인다(layout_store.py 설계 메모 참고). 바꾸는 것(PUT/DELETE)만
사장님 기기(X-Admin-Token)로 막는다 — 단가 설정과 같은 원칙."""
from fastapi import APIRouter, Header, HTTPException

from app import layout_store
from app.owner_auth import is_owner
from app.schemas import LayoutAdjustment, LayoutResponse

router = APIRouter(prefix="/api/layout", tags=["layout"])


def _require_owner(x_admin_token: str | None) -> None:
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 바꿀 수 있어요.")


@router.get("", response_model=LayoutResponse)
async def get_layout():
    return LayoutResponse(elements=layout_store.load())


@router.put("/{element_id}", response_model=LayoutResponse)
async def put_layout_element(
    element_id: str, adjustment: LayoutAdjustment, x_admin_token: str | None = Header(default=None)
):
    _require_owner(x_admin_token)
    return LayoutResponse(elements=layout_store.save_element(element_id, adjustment.model_dump()))


@router.delete("/{element_id}", response_model=LayoutResponse)
async def delete_layout_element(element_id: str, x_admin_token: str | None = Header(default=None)):
    _require_owner(x_admin_token)
    return LayoutResponse(elements=layout_store.delete_element(element_id))
