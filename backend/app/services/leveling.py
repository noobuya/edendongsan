"""레벨 계산식 — 뱃지 tier 가중합으로 원점수를 내고, 공식 뱃지(is_official) 없이는
Lv.2를 넘지 못하도록 하드 리밋을 건다. User.level 프로퍼티(app/models.py)가 호출한다.

레벨을 User 테이블 컬럼으로 저장하지 않고 항상 이 함수로 즉석 계산하는 이유:
뱃지가 추천·회수될 때마다 별도 컬럼을 동기화해야 하는 부담도, 클라이언트가 값을
조작해 보낼 여지도 둘 다 없앤다."""
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import SkillBadge

# score(뱃지 tier 합) 구간별 레벨 — 구간 상한은 다음 레벨 시작점.
LEVEL_SCORE_THRESHOLDS = [3, 6, 10, 15]  # Lv1: 0~2, Lv2: 3~5, Lv3: 6~9, Lv4: 10~14, Lv5: 15+
MAX_LEVEL = 5
# 공식 뱃지(is_official) 없이 도달할 수 있는 최고 레벨 — 아무리 XP/뱃지가 쌓여도
# 이 선을 넘으려면 반드시 관리자가 공식 뱃지를 수여해야 한다(어뷰징 방지).
UNOFFICIAL_LEVEL_CAP = 2

# JobReview 평점 1점당 지급하는 경험치. 범위 결정 (A) — XP는 현장 리뷰에서만
# 나온다(견적/블로그 쪽 이벤트는 건드리지 않는다, routers/recruiting.py 참고).
XP_PER_RATING_POINT = 10


def _raw_level_from_score(score: int) -> int:
    level = 1
    for threshold in LEVEL_SCORE_THRESHOLDS:
        if score >= threshold:
            level += 1
    return min(level, MAX_LEVEL)


def compute_level(badges: list["SkillBadge"]) -> tuple[int, int]:
    """보유 뱃지 목록으로 (레벨, 원점수)를 계산한다."""
    score = sum(b.tier for b in badges)
    raw_level = _raw_level_from_score(score)
    has_official = any(b.is_official for b in badges)
    if raw_level > UNOFFICIAL_LEVEL_CAP and not has_official:
        return UNOFFICIAL_LEVEL_CAP, score
    return raw_level, score
