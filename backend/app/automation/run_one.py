"""작업 1건을 실행하는 별도 프로세스: python -m app.automation.run_one <job_id>

브라우저(Selenium)가 멈추거나 메모리를 다 써도 워커/API에 번지지 않도록, 작업마다
새 프로세스로 돌리고 워커가 제한 시간이 지나면 통째로 종료한다.
"""
import sys
import traceback

from app.automation import store
from app.automation.tasks import TASKS


def main(job_id: str) -> None:
    task_id, params, secrets = store.load_for_run(job_id)
    task = TASKS.get(task_id)
    if not task:
        store.finish(job_id, None, f"알 수 없는 작업입니다: {task_id}")
        return
    try:
        result = task.run({**params, **secrets}, lambda line: store.append_log(job_id, line))
        store.finish(job_id, result or {}, None)
    except Exception as exc:  # noqa: BLE001 - 사용자에게 이유를 보여줘야 한다
        traceback.print_exc()
        store.finish(job_id, None, f"{type(exc).__name__}: {exc}"[:500])


if __name__ == "__main__":
    main(sys.argv[1])
