"""자동 정산 및 수익 통계 — quotes(JSON 견적 저장소)와 recruiting(SQLite 매칭
DB) 두 저장소를 "읽기 집계"로만 묶는다. 어느 매출이 어느 인건비 지출과 짝인지
건별로 추적하진 않는다 — 그러려면 quotes 견적 하나하나에 "이 FieldJob에서 나온
인건비"라는 연결 고리가 있어야 하는데, 지금 데이터 모델엔 그게 없다(포트폴리오
갤러리·캘린더 계약금 때와 같은 경계 — 지금은 "이번 달 매출 합"과 "이번 달 인건비
지출 합"을 나란히 보여주는 사업 전체 집계로 충분하다고 판단했다).

월 귀속 기준:
- 매출/자재비: 완료(status=done)된 견적의 완료일(서명일, 없으면 생성일)이 그 달.
- 인건비: COMPLETED 처리된 지원 건의 FieldJob.job_date(실제 작업한 날짜)가 그 달.
- 미수금 건수는 월과 무관한 현재 시점 스냅샷이다(잔금이 밀린 건 전부 센다)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy import func

from app.database import SessionLocal
from app.models import ApplicationStatus, FieldJob, JobApplication
from app.owner_auth import is_owner
from app.quotes_store import list_quotes
from app.schemas import FinanceMonthRow, FinanceSummaryResponse

router = APIRouter(prefix="/api/finance", tags=["finance"])

TREND_MONTHS = 6


def _require_owner(x_admin_token: str | None) -> None:
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 쓸 수 있어요.")


def _add_months(dt: datetime, n: int) -> datetime:
    """월 단위 가감 — 외부 라이브러리(dateutil) 없이 직접 계산한다. recruiting.py의
    캘린더 엔드포인트와 같은 방식."""
    total = dt.year * 12 + (dt.month - 1) + n
    year, month0 = divmod(total, 12)
    return dt.replace(year=year, month=month0 + 1)


def _parse_month(month: str) -> datetime:
    try:
        year, mon = (int(x) for x in month.split("-"))
        if not 1 <= mon <= 12:
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=422, detail="month는 YYYY-MM 형식이어야 합니다.") from None
    return datetime(year, mon, 1, tzinfo=timezone.utc)


def _quote_month_key(quote: dict) -> str | None:
    """완료된 견적이 귀속되는 달(YYYY-MM) — 서명일 우선, 없으면 생성일."""
    raw = (quote.get("signature") or {}).get("signed_at") or quote.get("created_at") or ""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return f"{dt.year:04d}-{dt.month:02d}"


def _revenue_and_material(month_start: datetime) -> tuple[int, int]:
    key = f"{month_start.year:04d}-{month_start.month:02d}"
    revenue = 0
    material = 0
    for quote in list_quotes():
        if quote.get("status") != "done":
            continue
        if _quote_month_key(quote) != key:
            continue
        estimate = quote.get("estimate") or {}
        revenue += estimate.get("total_cost", 0)
        material += estimate.get("material_total", 0)
    return revenue, material


def _labor_cost(month_start: datetime, month_end: datetime) -> int:
    db = SessionLocal()
    try:
        total = (
            db.query(func.coalesce(func.sum(FieldJob.pay), 0))
            .join(JobApplication, JobApplication.job_id == FieldJob.id)
            .filter(
                JobApplication.status == ApplicationStatus.COMPLETED,
                FieldJob.job_date >= month_start,
                FieldJob.job_date < month_end,
            )
            .scalar()
        )
        return int(total or 0)
    finally:
        db.close()


def _outstanding_count() -> int:
    count = 0
    for quote in list_quotes():
        if quote.get("status") == "done" and (quote.get("payment_status") or "pending") != "balance_paid":
            count += 1
    return count


def _month_summary(month_start: datetime) -> tuple[int, int, int]:
    month_end = _add_months(month_start, 1)
    revenue, material = _revenue_and_material(month_start)
    labor = _labor_cost(month_start, month_end)
    return revenue, material, labor


@router.get("/summary", response_model=FinanceSummaryResponse)
async def get_finance_summary(month: str, x_admin_token: str | None = Header(default=None)) -> FinanceSummaryResponse:
    _require_owner(x_admin_token)
    month_start = _parse_month(month)

    revenue, material, labor = _month_summary(month_start)
    net_profit = revenue - material - labor

    trend: list[FinanceMonthRow] = []
    for i in range(TREND_MONTHS - 1, -1, -1):
        m_start = _add_months(month_start, -i)
        m_revenue, m_material, m_labor = _month_summary(m_start)
        trend.append(
            FinanceMonthRow(
                month=f"{m_start.year:04d}-{m_start.month:02d}",
                revenue=m_revenue,
                net_profit=m_revenue - m_material - m_labor,
            )
        )

    return FinanceSummaryResponse(
        month=month,
        revenue=revenue,
        material_cost=material,
        labor_cost=labor,
        net_profit=net_profit,
        outstanding_count=_outstanding_count(),
        trend=trend,
    )
