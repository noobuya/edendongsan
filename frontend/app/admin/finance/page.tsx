"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, TrendingUp } from "lucide-react";
import { getFinanceSummary, type FinanceSummary } from "@/lib/api";

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
function monthLabel(month: string): string {
  const [, m] = month.split("-");
  return `${Number(m)}월`;
}

const input =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500";

/** 이번 달 구성비(자재비/인건비/순수익) 원형 차트 — 새 차트 라이브러리 없이
 *  conic-gradient로 직접 그린다(ROIBarChart의 '의존성 추가 없이 충분히 단순한
 *  비교' 원칙을 그대로 따름). 적자(순수익<0)면 조각 비율이 의미가 없어져
 *  파이 대신 경고 문구로 대체한다. */
function CompositionPie({ material, labor, netProfit }: { material: number; labor: number; netProfit: number }) {
  if (netProfit < 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-[13.5px] font-semibold text-rose-700">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        이번 달은 자재비+인건비가 매출을 넘어 적자예요.
      </div>
    );
  }
  const total = Math.max(material + labor + netProfit, 1);
  const materialPct = (material / total) * 100;
  const laborPct = (labor / total) * 100;
  const profitPct = 100 - materialPct - laborPct;
  const gradient = `conic-gradient(#f59e0b 0% ${materialPct}%, #6366f1 ${materialPct}% ${materialPct + laborPct}%, #10b981 ${materialPct + laborPct}% 100%)`;
  const legend = [
    { label: "자재비", value: material, color: "#f59e0b" },
    { label: "인건비", value: labor, color: "#6366f1" },
    { label: "순수익", value: netProfit, color: "#10b981" },
  ];
  return (
    <div className="flex items-center gap-5">
      <div className="h-28 w-28 shrink-0 rounded-full" style={{ background: gradient }} />
      <div className="space-y-1.5">
        {legend.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
            <span className="text-slate-500">{l.label}</span>
            <span className="font-semibold tabular-nums text-slate-800">{won(l.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 최근 6개월 매출·순수익 추이 막대그래프 — ROIBarChart와 같은 원칙(라이브러리 없이
 *  막대 높이를 %로 직접 계산). 한 달에 매출/순수익 막대 두 개를 나란히 세운다. */
function TrendBarChart({ trend }: { trend: FinanceSummary["trend"] }) {
  const max = Math.max(...trend.map((t) => Math.max(t.revenue, t.net_profit, 0)), 1);
  return (
    <div className="flex h-36 items-end gap-3">
      {trend.map((t) => (
        <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-28 w-full items-end justify-center gap-1">
            <div
              className="w-[40%] rounded-t-sm bg-slate-300"
              style={{ height: `${Math.max((t.revenue / max) * 100, 2)}%` }}
              title={`매출 ${won(t.revenue)}`}
            />
            <div
              className={`w-[40%] rounded-t-sm ${t.net_profit >= 0 ? "bg-indigo-500" : "bg-rose-400"}`}
              style={{ height: `${Math.max((Math.abs(t.net_profit) / max) * 100, 2)}%` }}
              title={`순수익 ${won(t.net_profit)}`}
            />
          </div>
          <span className="text-[11px] text-slate-400">{monthLabel(t.month)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminFinancePage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(t: string, m: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await getFinanceSummary(m, t);
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
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <TrendingUp className="h-5 w-5" /> 수익 대시보드
        </h1>
        <Link href="/admin/recruiting" className="text-[14px] text-slate-500 underline">
          매칭 관리
        </Link>
      </header>

      {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}

      <div className="flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <input type="month" className={`${input} h-11`} value={month} onChange={(e) => setMonth(e.target.value)} />
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
      </div>

      {summary && (
        <>
          {summary.outstanding_count > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-[13.5px] font-bold text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              아직 잔금이 입금되지 않은 현장: {summary.outstanding_count}건
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-[12.5px] text-slate-500">이번 달 매출</p>
              <p className="mt-1 text-[19px] font-extrabold tabular-nums text-slate-900">{won(summary.revenue)}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-[12.5px] text-slate-500">총 자재비</p>
              <p className="mt-1 text-[19px] font-extrabold tabular-nums text-amber-600">{won(summary.material_cost)}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-[12.5px] text-slate-500">총 인건비 지출</p>
              <p className="mt-1 text-[19px] font-extrabold tabular-nums text-indigo-600">{won(summary.labor_cost)}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-[12.5px] text-slate-500">순수익</p>
              <p className={`mt-1 text-[19px] font-extrabold tabular-nums ${summary.net_profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {won(summary.net_profit)}
              </p>
            </div>
          </div>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-slate-500">이번 달 구성비</h2>
            <CompositionPie material={summary.material_cost} labor={summary.labor_cost} netProfit={summary.net_profit} />
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-slate-500">
              최근 6개월 추이 <span className="font-normal normal-case text-slate-400">(매출 회색 · 순수익 보라)</span>
            </h2>
            <TrendBarChart trend={summary.trend} />
          </section>

          <p className="px-1 text-[11.5px] leading-relaxed text-slate-400">
            매출·자재비는 서명 완료일 기준, 인건비는 완료 처리된 현장의 작업일(job_date) 기준으로 집계돼요. 어느
            매출이 어느 인건비 지출과 짝인지는 건별로 추적하지 않는, 사업 전체 월간 집계예요.
          </p>
        </>
      )}
    </main>
  );
}
