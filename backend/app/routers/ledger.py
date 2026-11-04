"""가게부(장부) — 매출(완료 견적)·인건비(현장 지원 완료)처럼 이미 다른 저장소에
있는 사실과, 사장님이 직접 입력하는 기타 수입/지출(ledger_store.py)을 날짜순으로
한 화면에 합쳐 보여준다. finance.py가 "이번 달 매출 합"처럼 집계만 돌려주는
것과 달리, 여기는 건별로 늘어선 전표를 돌려준다 — 전통적인 장부처럼 한 줄 한
줄을 사장님이 눈으로 확인할 수 있게 하는 게 목적이다.

월 귀속 기준은 finance.py와 맞춘다(_quote_month_key 재사용): 매출은 서명일
(없으면 생성일), 인건비는 FieldJob.job_date. 수동 입력은 사장님이 직접 고른
날짜를 그대로 쓴다."""
from fastapi import APIRouter, Depends, Header, HTTPException

from app import ledger_store as store
from app.database import SessionLocal
from app.models import ApplicationStatus, FieldJob, JobApplication, User
from app.owner_auth import is_owner
from app.quotes_store import list_quotes
from app.routers.finance import _add_months, _parse_month, _quote_month_key
from app.schemas import LedgerEntry, LedgerEntryRequest, LedgerSummaryResponse, LedgerTransaction


def _require_owner(x_admin_token: str | None = Header(default=None)) -> None:
    if not is_owner(x_admin_token):
        raise HTTPException(status_code=401, detail="사장님 기기에서만 쓸 수 있어요.")


router = APIRouter(prefix="/api/ledger", tags=["ledger"], dependencies=[Depends(_require_owner)])


def _quote_date(quote: dict) -> str:
    """영수증 날짜 칸에 쓸 "YYYY-MM-DD" — 서명일 우선, 없으면 생성일."""
    raw = (quote.get("signature") or {}).get("signed_at") or quote.get("created_at") or ""
    return raw[:10]


def _quote_transactions(month: str) -> list[LedgerTransaction]:
    rows = []
    for quote in list_quotes():
        if quote.get("status") != "done" or quote.get("kind") == "blog_only":
            continue
        if _quote_month_key(quote) != month:
            continue
        estimate = quote.get("estimate") or {}
        rows.append(
            LedgerTransaction(
                id=f"quote:{quote['job_id']}",
                date=_quote_date(quote),
                type="income",
                category="매출",
                counterparty=quote.get("customer_name") or "고객명 미입력",
                amount=estimate.get("total_cost", 0),
                memo="시공 견적",
                source="quote",
                job_id=quote["job_id"],
            )
        )
    return rows


def _labor_transactions(month: str) -> list[LedgerTransaction]:
    month_start = _parse_month(month)
    month_end = _add_months(month_start, 1)

    db = SessionLocal()
    try:
        rows = (
            db.query(FieldJob.job_date, FieldJob.pay, FieldJob.location, User.name)
            .join(JobApplication, JobApplication.job_id == FieldJob.id)
            .join(User, User.id == JobApplication.student_id)
            .filter(
                JobApplication.status == ApplicationStatus.COMPLETED,
                FieldJob.job_date >= month_start,
                FieldJob.job_date < month_end,
            )
            .all()
        )
    finally:
        db.close()

    return [
        LedgerTransaction(
            id=f"labor:{job_date.isoformat()}:{name}:{pay}",
            date=job_date.date().isoformat(),
            type="expense",
            category="인건비",
            counterparty=name,
            amount=pay,
            memo=location,
            source="labor",
        )
        for job_date, pay, location, name in rows
    ]


def _manual_transactions(month: str) -> list[LedgerTransaction]:
    return [
        LedgerTransaction(
            id=f"manual:{e['id']}",
            date=e["date"],
            type=e["type"],
            category=e["category"],
            counterparty=e["counterparty"],
            amount=e["amount"],
            memo=e["memo"],
            source="manual",
        )
        for e in store.list_entries(month)
    ]


@router.get("/summary", response_model=LedgerSummaryResponse)
async def get_summary(month: str):
    _parse_month(month)  # 형식이 잘못되면 422로 거절(finance.py와 같은 검증)

    transactions = [*_quote_transactions(month), *_labor_transactions(month), *_manual_transactions(month)]
    transactions.sort(key=lambda t: t.date, reverse=True)

    income_total = sum(t.amount for t in transactions if t.type == "income")
    expense_total = sum(t.amount for t in transactions if t.type == "expense")

    return LedgerSummaryResponse(
        month=month,
        income_total=income_total,
        expense_total=expense_total,
        net=income_total - expense_total,
        transactions=transactions,
    )


@router.get("/entries", response_model=list[LedgerEntry])
async def list_manual_entries(month: str | None = None):
    return store.list_entries(month)


@router.post("/entries", response_model=LedgerEntry)
async def create_manual_entry(payload: LedgerEntryRequest):
    return store.create_entry(
        payload.date, payload.type, payload.category.strip(), payload.counterparty.strip(), payload.amount,
        payload.memo.strip(),
    )


@router.patch("/entries/{entry_id}", response_model=LedgerEntry)
async def update_manual_entry(entry_id: str, payload: LedgerEntryRequest):
    updated = store.update_entry(
        entry_id, payload.date, payload.type, payload.category.strip(), payload.counterparty.strip(),
        payload.amount, payload.memo.strip(),
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="장부 항목을 찾을 수 없습니다.")
    return updated


@router.delete("/entries/{entry_id}")
async def delete_manual_entry(entry_id: str):
    if not store.delete_entry(entry_id):
        raise HTTPException(status_code=404, detail="장부 항목을 찾을 수 없습니다.")
    return {"ok": True}
