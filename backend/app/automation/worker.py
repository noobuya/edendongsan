"""대기열 워커: python -m app.automation.worker

한 번에 1건만 실행한다(서버 메모리가 작아 브라우저를 동시에 여러 개 띄우면 서버가 죽는다).
"""
import subprocess
import sys
import time

from app.automation import store

JOB_TIMEOUT_SEC = 300


def main() -> None:
    store.recover_stuck()
    print("automation worker started", flush=True)
    while True:
        job_id = store.claim_next()
        if not job_id:
            time.sleep(2)
            continue
        print(f"run {job_id}", flush=True)
        try:
            subprocess.run(
                [sys.executable, "-m", "app.automation.run_one", job_id],
                timeout=JOB_TIMEOUT_SEC,
                check=False,
            )
        except subprocess.TimeoutExpired:
            store.finish(job_id, None, f"{JOB_TIMEOUT_SEC // 60}분 안에 끝나지 않아 중단했습니다.")
        # 프로세스가 결과를 남기지 못하고 죽은 경우
        job = store.get(job_id)
        if job and job["status"] == "running":
            store.finish(job_id, None, "작업이 비정상 종료되었습니다.")


if __name__ == "__main__":
    main()
