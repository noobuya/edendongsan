"""사장님 기기의 FCM 푸시 토큰 등록 — 조공/기공 쪽 등록은 X-Access-Code 인증을
그대로 쓸 수 있는 recruiting.py에 둔다(이 라우터와 분리한 이유는 owner_auth.py가
쓰는 인증 방식이 거기와 다르기 때문)."""
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PushToken
from app.owner_auth import is_owner
from app.schemas import PushTokenRequest

router = APIRouter(prefix="/api/push", tags=["push"])


@router.post("/register")
def register_owner_push_token(
    payload: PushTokenRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 등록할 수 있어요.")
    existing = db.query(PushToken).filter(PushToken.token == payload.token).first()
    if existing:
        existing.is_owner = True
        existing.user_id = None
    else:
        db.add(PushToken(token=payload.token, is_owner=True))
    db.commit()
    return {"ok": True}
