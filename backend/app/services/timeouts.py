"""외부 API 호출(Replicate/Gemini)이 응답 없이 무한정 블로킹되는 것을 막는 공용 타임아웃 래퍼.

SAM-2/Gemini SDK가 자체 타임아웃을 지원하는지와 무관하게, 별도 스레드에서 호출을
실행하고 result(timeout=...)로 강제 마감한다. 시간 초과 시 원래 호출 스레드는
버려두고(daemon 아님이지만 결과를 기다리지 않음) 즉시 TimeoutError를 던져
백그라운드 잡이 "처리 중" 상태로 영원히 멈춰 있는 상황(무한 로딩)을 방지한다.
"""
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Callable, ParamSpec, TypeVar

from google.genai import errors as genai_errors
from replicate.exceptions import ReplicateError

P = ParamSpec("P")
T = TypeVar("T")


def run_with_timeout(fn: Callable[P, T], timeout_s: float, *args: P.args, **kwargs: P.kwargs) -> T:
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(fn, *args, **kwargs)
    try:
        return future.result(timeout=timeout_s)
    except FutureTimeoutError as exc:
        raise TimeoutError(f"외부 API 응답이 {timeout_s:.0f}초 내에 오지 않았습니다.") from exc
    finally:
        # wait=False: 시간 초과된 호출이 뒤늦게 끝나더라도 호출자를 더 붙잡아두지 않는다.
        executor.shutdown(wait=False)


def run_replicate_with_retry(
    fn: Callable[P, T],
    timeout_s: float,
    *args: P.args,
    max_retries: int = 2,
    retry_wait_s: float = 11.0,
    **kwargs: P.kwargs,
) -> T:
    """Replicate 계정 크레딧이 $5 미만이면 분당 6건·버스트 1건으로 강하게
    쓰로틀링된다(429). 한 견적 안에서 SAM 세그멘테이션 + 벽/조명·실링팬/싱크볼
    인페인팅까지 여러 번 연달아 호출하면 이 한도에 바로 걸려, 실제로는 API가
    정상인데도 매번 실패→폴백으로 조용히 떨어지는 문제가 있었다. 429일 때만
    잠깐 기다렸다 재시도한다 (그 외 오류는 그대로 올려 기존 폴백 로직이 처리).

    순수 TimeoutError는 여기서 재시도하지 않는다 — SAM_TIMEOUT_S(90초)/
    INPAINT_TIMEOUT_S(120초)가 이미 길게 잡혀 있어, 재시도까지 더하면 프론트엔드
    폴링 타임아웃(120초)보다 백엔드가 더 오래 걸려 "무한 로딩"이 재발한다.
    대신 이 파이프라인은 timeout/실패 시 휴리스틱 폴백(사각형 마스크, 텍스처
    워핑, 컷아웃 합성)으로 즉시 넘어가도록 이미 설계돼 있으므로, 여기서는 그대로
    올려 그 폴백 경로를 타게 둔다."""
    last_exc: ReplicateError | None = None
    for attempt in range(max_retries + 1):
        try:
            return run_with_timeout(fn, timeout_s, *args, **kwargs)
        except ReplicateError as exc:
            last_exc = exc
            if exc.status == 429 and attempt < max_retries:
                time.sleep(retry_wait_s)
                continue
            raise
    raise last_exc  # pragma: no cover - 위 루프가 항상 return/raise로 끝남


# 재시도할 가치가 있는 상태 코드만 골랐다 — 429(쓰로틀/크레딧 한도)와
# 503(모델 일시적 과부하, "high demand" 응답)은 잠깐 기다리면 풀리는 일시적
# 오류지만, 401/403(키 문제)이나 400(요청 자체가 잘못됨)은 몇 번을 재시도해도
# 똑같이 실패하므로 즉시 올려서 원인을 바로 알 수 있게 한다.
GEMINI_RETRYABLE_CODES = {429, 503}


def run_gemini_with_retry(
    fn: Callable[P, T],
    timeout_s: float,
    *args: P.args,
    max_retries: int = 2,
    retry_wait_s: float = 8.0,
    backoff_factor: float = 1.0,
    retry_on_timeout: bool = False,
    **kwargs: P.kwargs,
) -> T:
    """Gemini가 일시적으로 과부하(503 UNAVAILABLE)이거나 분당 한도(429)에 걸렸을 때
    잠깐 기다렸다 재시도한다. 크레딧을 막 충전한 직후에도 이 두 상태가 몇 분간
    번갈아 나올 수 있어(실측: 429 RESOURCE_EXHAUSTED 다음 호출에서 503 UNAVAILABLE이
    여러 번 반복됐고, 같은 이미지+프롬프트로 별도 호출한 즉석 테스트는 바로 성공했다
    — 즉 키/크레딧 문제가 아니라 멀티모달 요청에 대한 구글 쪽 일시적 과부하다),
    한 번 실패했다고 바로 폴백/에러로 떨어뜨리면 충전이 반영됐는데도 계속 실패하는
    것처럼 보인다. backoff_factor > 1이면 재시도마다 대기 시간을 늘려(지수 백오프)
    과부하가 오래갈 때도 성공 확률을 높인다.

    과부하는 항상 빠른 503로 오지 않는다 — 실측 결과 congestion이 심할 때는
    빠르게 거부되는 대신 timeout_s를 넘길 때까지 그냥 응답이 없는 경우도 있었다.
    run_with_timeout()이 그 경우 (genai_errors.APIError가 아니라) 표준 TimeoutError를
    던지는데, 이 함수가 APIError만 잡고 있으면 timeout은 재시도 없이 즉시 실패로
    새어나가 재시도 로직 자체가 무력화된다.

    다만 TimeoutError 재시도는 retry_on_timeout=True일 때만 켠다 — segmentation.py/
    vision_client.py의 호출들은 SAM_TIMEOUT_S(90초)까지 포함한 파이프라인 전체가
    프론트엔드 폴링 타임아웃(120초) 안에 끝나야 해서, 여기에 재시도를 더하면
    "무한 로딩"이 재발한다. 반대로 블로그 생성처럼 사용자가 버튼을 눌러 별도로
    기다리는 단발성 호출에서는 꺼야 할 이유가 없다."""
    last_exc: Exception | None = None
    wait = retry_wait_s
    for attempt in range(max_retries + 1):
        try:
            return run_with_timeout(fn, timeout_s, *args, **kwargs)
        except genai_errors.APIError as exc:
            last_exc = exc
            if exc.code in GEMINI_RETRYABLE_CODES and attempt < max_retries:
                time.sleep(wait)
                wait *= backoff_factor
                continue
            raise
        except TimeoutError as exc:
            last_exc = exc
            if retry_on_timeout and attempt < max_retries:
                time.sleep(wait)
                wait *= backoff_factor
                continue
            raise
    raise last_exc  # pragma: no cover - 위 루프가 항상 return/raise로 끝남
