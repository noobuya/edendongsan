"""사장님 전용 기능(일러스트 문구·그림 등)을 여는 확인.

관리자 토큰(ADMIN_TOKEN)과 같은 값을 X-Admin-Token 헤더로 받는다. 토큰이 없거나
서버에 ADMIN_TOKEN이 설정되어 있지 않으면 사장님이 아닌 것으로 본다(실패는 닫힌 쪽으로).
"""
import hmac

from app.config import get_settings


def is_owner(token: str | None) -> bool:
    expected = get_settings().admin_token
    if not expected or not token:
        return False
    return hmac.compare_digest(token.encode(), expected.encode())
