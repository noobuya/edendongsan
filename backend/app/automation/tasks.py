"""자동화 작업 등록부.

새 자동화(예: 인테리어 필름 발주 Selenium 스크립트)는 여기에 `Task`를 하나 추가하면
화면(입력 폼)과 대기열에 자동으로 나타난다. `run`은 별도 프로세스에서 실행되므로
브라우저가 멈춰도 API 서버에는 영향이 없다.
"""
import time
from dataclasses import dataclass, field
from typing import Callable

LogFn = Callable[[str], None]


@dataclass
class Field:
    key: str
    label: str
    type: str = "text"  # text | number | password | textarea
    required: bool = True
    secret: bool = False  # True면 작업이 끝나는 즉시 DB에서 지운다(비밀번호 등)
    placeholder: str = ""


@dataclass
class Task:
    id: str
    title: str
    description: str
    run: Callable[[dict, LogFn], dict]
    fields: list[Field] = field(default_factory=list)


def _connection_test(params: dict, log: LogFn) -> dict:
    """대기열·워커가 정상인지 확인하는 테스트 작업(브라우저는 열지 않는다)."""
    try:
        seconds = int(params.get("seconds") or 5)
    except ValueError:
        seconds = 5
    seconds = min(max(seconds, 1), 30)
    for i in range(seconds):
        log(f"{i + 1}/{seconds}초 진행 중")
        time.sleep(1)
    return {"message": f"{params.get('memo') or '메모 없음'} — 정상 처리됨", "seconds": seconds}


TASKS: dict[str, Task] = {
    t.id: t
    for t in [
        Task(
            id="connection-test",
            title="연결 테스트",
            description="대기열과 워커가 잘 돌아가는지 확인합니다(실제 발주는 하지 않아요).",
            fields=[
                Field("memo", "메모", required=False, placeholder="아무 말이나 적어보세요"),
                Field("seconds", "걸리는 시간(초, 1~30)", type="number", required=False, placeholder="5"),
            ],
            run=_connection_test,
        ),
        # TODO: 기존 Selenium 인테리어 필름 스크립트를 이 자리에 Task로 이식한다.
    ]
}
