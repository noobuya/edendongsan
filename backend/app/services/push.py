"""Firebase Cloud Messaging(FCM)으로 기기에 실시간 알림을 보낸다.

쓰는 곳(모두 "가장 반응이 빠를 때" 알려야 의미가 있는 순간들):
  - 고객이 제안서 공개 링크를 처음 열었을 때 -> 사장님 전 기기
  - 기공이 조공을 지명 호출했을 때 -> 그 조공
  - 기공이 헬프콜(FieldJob.audience=EXPERT)을 올렸을 때 -> 다른 기공 전원

[서비스 계정 키가 아직 없어도 앱은 멈추지 않는다] FIREBASE_CREDENTIALS_PATH가
비어 있거나 파일이 없으면 send_push는 아무 일도 하지 않고 조용히 리턴한다 —
푸시는 있으면 좋은 부가 기능이지, 없다고 지명 호출·헬프콜·제안서 열람 같은
핵심 동작이 막히면 안 된다."""
import os

import firebase_admin
from firebase_admin import credentials, messaging

from app.config import get_settings

_initialized = False


def _ensure_initialized() -> bool:
    global _initialized
    if _initialized:
        return True
    cred_path = get_settings().firebase_credentials_path
    if not cred_path or not os.path.exists(cred_path):
        return False
    try:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        _initialized = True
        return True
    except Exception as exc:  # noqa: BLE001 - 설정 오류로 앱 시작 자체가 막히면 안 된다
        print(f"[push] Firebase 초기화 실패: {exc}")
        return False


def send_push(tokens: list[str], title: str, body: str, data: dict[str, str] | None = None) -> None:
    """토큰 목록에 같은 알림을 한 번에 보낸다. 실패해도 예외를 올리지 않는다 —
    호출하는 쪽(지명 호출 생성 등)의 핵심 로직이 알림 발송 실패로 롤백되면 안 된다."""
    tokens = [t for t in tokens if t]
    if not tokens or not _ensure_initialized():
        return
    message = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        data=data or {},
        tokens=tokens,
    )
    try:
        response = messaging.send_each_for_multicast(message)
        if response.failure_count:
            print(f"[push] {response.failure_count}/{len(tokens)}건 발송 실패")
    except Exception as exc:  # noqa: BLE001 - 외부 서비스 실패가 호출자에게 번지면 안 된다
        print(f"[push] 발송 실패: {exc}")
