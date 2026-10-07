"""견적 공유 커뮤니티 API. 고객 정보를 다루지 않으므로 조회·등록은 인증이 필요 없다
(완성 견적에서 품목·단가·총액만 뽑아 올리는 참고 게시판). 삭제만 모더레이션용으로
사장님 토큰을 요구한다."""
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app import community_store as store
from app.owner_auth import is_owner
from app.schemas import LineItem

router = APIRouter(prefix="/api/community", tags=["community"])


class ShareIn(BaseModel):
    author: str = Field(min_length=1, max_length=20)
    item_names: list[str] = Field(default_factory=list, max_length=20)
    line_items: list[LineItem]
    total_cost: int = Field(ge=0)
    note: str = Field(default="", max_length=500)


@router.post("/estimates")
async def create_estimate(req: ShareIn):
    author = req.author.strip()
    if not author:
        raise HTTPException(422, "이름을 입력해 주세요.")
    if not req.line_items:
        raise HTTPException(422, "공유할 견적 내용이 없어요.")
    return store.create_share(
        author,
        req.item_names,
        [item.model_dump() for item in req.line_items],
        req.total_cost,
        req.note.strip(),
    )


@router.get("/estimates")
async def list_estimates(q: str = ""):
    return store.list_shares(q)


@router.get("/estimates/{estimate_id}")
async def get_estimate(estimate_id: str):
    share = store.get_share(estimate_id)
    if share is None:
        raise HTTPException(404, "공유된 견적을 찾을 수 없어요.")
    return share


@router.delete("/estimates/{estimate_id}")
async def delete_estimate(estimate_id: str, x_admin_token: str | None = Header(default=None)):
    if not is_owner(x_admin_token):
        raise HTTPException(401, "사장님 기기에서만 지울 수 있어요.")
    if not store.delete_share(estimate_id):
        raise HTTPException(404, "공유된 견적을 찾을 수 없어요.")
    return {"ok": True}
