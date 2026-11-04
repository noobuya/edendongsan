"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookText, Loader2, Pencil, Plus, Trash2, TrendingUp, X } from "lucide-react";
import {
  createLedgerEntry,
  deleteLedgerEntry,
  getLedgerSummary,
  updateLedgerEntry,
  type LedgerEntry,
  type LedgerEntryInput,
  type LedgerEntryType,
  type LedgerSummary,
  type LedgerTransaction,
} from "@/lib/api";

const TOKEN_KEY = "eden-admin-token";

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeToken(value: string) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}
function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
  return `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))} (${WEEKDAY[d.getDay()]})`;
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const INCOME_CATEGORIES = ["기타수입", "중고 장비 판매", "환급"];
const EXPENSE_CATEGORIES = ["자재비", "유류비", "공구/장비", "사무용품", "통신비", "세금/보험", "수수료", "기타지출"];

const SOURCE_LABEL: Record<LedgerTransaction["source"], string> = { quote: "매출", labor: "인건비", manual: "수동" };

const input =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500";
const label = "mb-1.5 block text-[12.5px] font-semibold text-slate-500";

interface FormState {
  id: string | null;
  date: string;
  type: LedgerEntryType;
  category: string;
  counterparty: string;
  amount: string;
  memo: string;
}

function emptyForm(type: LedgerEntryType = "expense"): FormState {
  return { id: null, date: todayIso(), type, category: "", counterparty: "", amount: "", memo: "" };
}

export default function AdminLedgerPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load(t: string, m: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await getLedgerSummary(m, t);
      setSummary(data);
      setToken(t);
      setAuthorized(true);
      writeToken(t);
    } catch (e) {
      setAuthorized(false);
      writeToken("");
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const saved = readToken();
    if (saved) void load(saved, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authorized && token) void load(token, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const categories = useMemo(() => (form?.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES), [form?.type]);

  function openCreate(type: LedgerEntryType) {
    setForm(emptyForm(type));
  }
  function openEdit(entry: LedgerTransaction) {
    setForm({
      id: entry.id.replace(/^manual:/, ""),
      date: entry.date,
      type: entry.type,
      category: entry.category,
      counterparty: entry.counterparty,
      amount: String(entry.amount),
      memo: entry.memo,
    });
  }

  async function submitForm() {
    if (!form) return;
    const amount = Math.round(Number(form.amount));
    if (!form.category.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError("분류와 금액(0보다 큰 수)을 입력해주세요.");
      return;
    }
    const payload: LedgerEntryInput = {
      date: form.date,
      type: form.type,
      category: form.category.trim(),
      counterparty: form.counterparty.trim(),
      amount,
      memo: form.memo.trim(),
    };
    setSaving(true);
    setError(null);
    try {
      if (form.id) await updateLedgerEntry(form.id, payload, token);
      else await createLedgerEntry(payload, token);
      setForm(null);
      await load(token, month);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entry: LedgerTransaction) {
    const id = entry.id.replace(/^manual:/, "");
    setDeletingId(id);
    setError(null);
    try {
      await deleteLedgerEntry(id, token);
      await load(token, month);
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  if (!authorized) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">관리자 로그인</h1>
        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[14px] text-slate-600">서버에 설정된 관리자 토큰을 입력하세요.</p>
          <input
            type="password"
            className={input}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="관리자 토큰"
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && tokenInput && load(tokenInput.trim(), month)}
          />
          <button
            disabled={busy || !tokenInput.trim()}
            onClick={() => load(tokenInput.trim(), month)}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "들어가기"}
          </button>
          {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6 pb-24">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <BookText className="h-5 w-5" /> 가게부
        </h1>
        <Link href="/admin/finance" className="flex items-center gap-1 text-[14px] text-slate-500 underline">
          <TrendingUp className="h-3.5 w-3.5" /> 수익 대시보드
        </Link>
      </header>

      {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}

      <div className="flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <input type="month" className={`${input} h-11`} value={month} onChange={(e) => setMonth(e.target.value)} />
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-2xl bg-white p-3.5 shadow-sm">
              <p className="text-[12px] text-slate-500">수입</p>
              <p className="mt-1 text-[16px] font-extrabold tabular-nums text-emerald-600">
                {won(summary.income_total)}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-3.5 shadow-sm">
              <p className="text-[12px] text-slate-500">지출</p>
              <p className="mt-1 text-[16px] font-extrabold tabular-nums text-rose-600">{won(summary.expense_total)}</p>
            </div>
            <div className="rounded-2xl bg-white p-3.5 shadow-sm">
              <p className="text-[12px] text-slate-500">순이익</p>
              <p className={`mt-1 text-[16px] font-extrabold tabular-nums ${summary.net >= 0 ? "text-slate-900" : "text-rose-600"}`}>
                {won(summary.net)}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => openCreate("income")}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 text-[14px] font-bold text-emerald-700"
            >
              <Plus className="h-4 w-4" /> 수입 추가
            </button>
            <button
              type="button"
              onClick={() => openCreate("expense")}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-50 text-[14px] font-bold text-rose-700"
            >
              <Plus className="h-4 w-4" /> 지출 추가
            </button>
          </div>

          {form && (
            <section className="space-y-3 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-slate-900">
                  {form.id ? "항목 수정" : form.type === "income" ? "수입 추가" : "지출 추가"}
                </h2>
                <button type="button" onClick={() => setForm(null)} aria-label="닫기" className="text-slate-400">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={label}>날짜</span>
                  <input
                    type="date"
                    className={input}
                    value={form.date}
                    onChange={(e) => setForm((f) => (f ? { ...f, date: e.target.value } : f))}
                  />
                </div>
                <div>
                  <span className={label}>금액</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    className={input}
                    value={form.amount}
                    placeholder="0"
                    onChange={(e) => setForm((f) => (f ? { ...f, amount: e.target.value } : f))}
                  />
                </div>
              </div>

              <div>
                <span className={label}>분류</span>
                <input
                  className={input}
                  list="ledger-categories"
                  value={form.category}
                  placeholder="예: 유류비"
                  onChange={(e) => setForm((f) => (f ? { ...f, category: e.target.value } : f))}
                />
                <datalist id="ledger-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <span className={label}>거래처 (선택)</span>
                <input
                  className={input}
                  value={form.counterparty}
                  placeholder="예: OO자재상"
                  onChange={(e) => setForm((f) => (f ? { ...f, counterparty: e.target.value } : f))}
                />
              </div>

              <div>
                <span className={label}>메모 (선택)</span>
                <input
                  className={input}
                  value={form.memo}
                  onChange={(e) => setForm((f) => (f ? { ...f, memo: e.target.value } : f))}
                />
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={submitForm}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "저장"}
              </button>
            </section>
          )}

          <section className="rounded-2xl bg-white shadow-sm">
            <h2 className="px-4 pt-4 text-[13px] font-bold uppercase tracking-wider text-slate-500">
              거래 내역 <span className="font-normal normal-case text-slate-400">({summary.transactions.length}건)</span>
            </h2>
            {summary.transactions.length === 0 ? (
              <p className="px-4 py-8 text-center text-[14px] text-slate-400">이 달에는 거래 내역이 없어요.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {summary.transactions.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-14 shrink-0 text-[12px] text-slate-400">{dateLabel(t.date)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${
                            t.source === "quote"
                              ? "bg-indigo-50 text-indigo-700"
                              : t.source === "labor"
                                ? "bg-amber-50 text-amber-700"
                                : t.type === "income"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {SOURCE_LABEL[t.source]}
                        </span>
                        <p className="min-w-0 truncate text-[14px] font-semibold text-slate-900">{t.category}</p>
                      </div>
                      <p className="mt-0.5 truncate text-[12.5px] text-slate-400">
                        {[t.counterparty, t.memo].filter(Boolean).join(" · ") || "-"}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-[15px] font-bold tabular-nums ${
                        t.type === "income" ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {t.type === "income" ? "+" : "-"}
                      {won(t.amount)}
                    </p>
                    {t.source === "quote" && t.job_id ? (
                      <Link
                        href={`/?job=${t.job_id}`}
                        className="shrink-0 rounded-lg bg-slate-50 px-2 py-1.5 text-[12px] font-semibold text-slate-500"
                      >
                        보기
                      </Link>
                    ) : t.source === "manual" ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label="수정"
                          onClick={() => openEdit(t)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="삭제"
                          disabled={deletingId === t.id.replace(/^manual:/, "")}
                          onClick={() => removeEntry(t)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500 disabled:opacity-50"
                        >
                          {deletingId === t.id.replace(/^manual:/, "") ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="px-1 text-[11.5px] leading-relaxed text-slate-400">
            매출은 서명 완료일(없으면 생성일), 인건비는 완료 처리된 현장의 작업일 기준으로 자동 집계돼요. 그 밖의
            수입·지출은 직접 추가한 항목이에요 — 연필 아이콘으로 고칠 수 있어요.
          </p>
        </>
      )}
    </main>
  );
}
