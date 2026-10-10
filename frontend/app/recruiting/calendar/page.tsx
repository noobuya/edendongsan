"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import "react-calendar/dist/Calendar.css";
import { ArrowLeft, Loader2, MapPin, Wallet } from "lucide-react";

// react-calendar는 SSR과 클라이언트 렌더링 결과가 미묘하게 달라 하이드레이션
// 경고가 떴다(실측) — ssr:false로 클라이언트에서만 그리게 해서 없앤다.
const Calendar = dynamic(() => import("react-calendar"), { ssr: false });
import {
  recruitingCalendar,
  recruitingSetDepositConfirmed,
  type CalendarJobRow,
} from "@/lib/api";
import { useAndroidBack } from "@/lib/useAndroidBack";

const CODE_KEY = "eden-recruiting-code";
const CARD = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70";
const AUDIENCE_LABEL: Record<CalendarJobRow["audience"], string> = { STUDENT: "조공 구인", EXPERT: "동급 기공 헬프콜" };

function readCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatPay(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 기공(EXPERT) 전용 월별 일정 대시보드 — react-calendar 달력 위에 공고가 있는
 *  날짜를 점으로 표시하고, 날짜를 고르면 그날 공고의 투입 현황(지원자 상태별
 *  집계)과 계약금 확인 여부를 보여준다. deposit_confirmed는 기공이 직접 체크하는
 *  자체 플래그다 — 고객 견적 시스템의 실제 계약금 데이터와는 연결돼 있지 않다
 *  (recruiting.py의 설계 메모 참고). */
export default function RecruitingCalendarPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  // 빈 문자열로 시작해 서버/클라이언트 첫 렌더가 똑같게 두고, localStorage 읽기는
  // useEffect에서만 한다 — useState 초기화 함수로 바로 읽으면 SSR(빈 값)과 클라이언트
  // (실제 값)의 첫 렌더 결과가 달라져 하이드레이션 에러가 난다(실측으로 발견).
  const [code, setCode] = useState("");
  useEffect(() => setCode(readCode()), []);
  const [activeStartDate, setActiveStartDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [jobs, setJobs] = useState<CalendarJobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setError("먼저 /recruiting에서 입장해 주세요.");
      return;
    }
    setError(null);
    setJobs(null);
    recruitingCalendar(code, monthKey(activeStartDate))
      .then(setJobs)
      .catch((err) => setError(err instanceof Error ? err.message : "불러오지 못했습니다."));
  }, [code, activeStartDate]);

  const jobsByDay = (jobs ?? []).reduce<Record<string, CalendarJobRow[]>>((acc, job) => {
    const key = dayKey(new Date(job.job_date));
    (acc[key] ??= []).push(job);
    return acc;
  }, {});
  const selectedJobs = jobsByDay[dayKey(selectedDate)] ?? [];

  async function toggleDeposit(job: CalendarJobRow) {
    setBusy(true);
    setError(null);
    try {
      await recruitingSetDepositConfirmed(code, job.id, !job.deposit_confirmed);
      setJobs(await recruitingCalendar(code, monthKey(activeStartDate)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#f2f4f6] pb-20 text-slate-900">
      <header className="sticky top-0 z-10 bg-[#f2f4f6]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4">
          <Link href="/recruiting" aria-label="뒤로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[17px] font-bold tracking-tight">일정 캘린더</h1>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-3 px-4 pt-4">
        {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}

        {code && (
          <div className={`${CARD} eden-calendar`}>
            <Calendar
              value={selectedDate}
              activeStartDate={activeStartDate}
              onActiveStartDateChange={({ activeStartDate: next }) => next && setActiveStartDate(next)}
              onChange={(value) => value instanceof Date && setSelectedDate(value)}
              locale="ko-KR"
              calendarType="gregory"
              tileContent={({ date, view }) => {
                if (view !== "month") return null;
                const count = jobsByDay[dayKey(date)]?.length ?? 0;
                if (count === 0) return null;
                return (
                  <div className="mt-0.5 flex justify-center gap-0.5">
                    {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                      <span key={i} className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    ))}
                  </div>
                );
              }}
            />
          </div>
        )}

        {jobs === null && !error && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </div>
        )}

        {jobs !== null && (
          <section className="space-y-2">
            <h2 className="px-1 text-[13px] font-bold uppercase tracking-wider text-slate-500">
              {selectedDate.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} 일정 {selectedJobs.length}건
            </h2>
            {selectedJobs.length === 0 ? (
              <p className="px-1 text-[13.5px] text-slate-400">이 날짜엔 공고가 없어요.</p>
            ) : (
              selectedJobs.map((job) => (
                <div key={job.id} className={CARD}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        {AUDIENCE_LABEL[job.audience]}
                      </span>
                      <p className="mt-1 flex items-center gap-1.5 text-[14.5px] font-bold text-slate-900">
                        <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                        {job.location}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-slate-500">{formatTime(job.job_date)}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold text-slate-700">
                        <Wallet className="h-3.5 w-3.5 text-slate-400" />
                        {formatPay(job.pay)}
                      </p>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => toggleDeposit(job)}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-40 ${
                        job.deposit_confirmed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {job.deposit_confirmed ? "계약금 확인됨" : "계약금 미확인"}
                    </button>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5 text-[11.5px]">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">대기 {job.applicants.pending}</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">승인 {job.applicants.approved}</span>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">완료 {job.applicants.completed}</span>
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">거절 {job.applicants.rejected}</span>
                  </div>
                </div>
              ))
            )}
          </section>
        )}
      </div>
    </main>
  );
}
