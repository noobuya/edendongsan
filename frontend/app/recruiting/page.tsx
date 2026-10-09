"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase, CheckCircle2, Loader2, LogOut, MapPin, Sparkles, Wallet, XCircle } from "lucide-react";
import {
  recruitingApplicants,
  recruitingApply,
  recruitingBadges,
  recruitingCreateJob,
  recruitingDecide,
  recruitingMe,
  recruitingMyApplications,
  recruitingMyBadges,
  recruitingMyJobs,
  recruitingOpenJobs,
  recruitingSignup,
  recruitingSignupStatus,
  type Applicant,
  type FieldJob,
  type MyApplication,
  type MyBadge,
  type RecruitingRole,
  type RecruitingUser,
  type SkillBadge,
} from "@/lib/api";

const CODE_KEY = "eden-recruiting-code";
const REQUEST_KEY = "eden-recruiting-request";

const INPUT =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20";
const CARD = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70";
const PRIMARY =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[15px] font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40";

const JOB_STATUS_LABEL: Record<FieldJob["status"], string> = { OPEN: "모집중", CLOSED: "마감", COMPLETED: "완료" };
const APP_STATUS_TONE: Record<MyApplication["status"], string> = {
  PENDING: "bg-slate-100 text-slate-600",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-rose-50 text-rose-700",
};
const APP_STATUS_LABEL: Record<MyApplication["status"], string> = { PENDING: "대기중", APPROVED: "승인됨", REJECTED: "거절됨" };

function readSaved(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}
function readRequestId(): string {
  try {
    return localStorage.getItem(REQUEST_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeRequestId(id: string) {
  try {
    if (id) localStorage.setItem(REQUEST_KEY, id);
    else localStorage.removeItem(REQUEST_KEY);
  } catch {}
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatPay(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <Sparkles className="h-6 w-6 text-slate-400" />
      <p className="text-[14px] leading-relaxed text-slate-500 break-keep">{children}</p>
    </div>
  );
}

export default function RecruitingPage() {
  const [code, setCode] = useState("");
  const [me, setMe] = useState<RecruitingUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<"signup" | "code">("signup");
  const [codeInput, setCodeInput] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupRole, setSignupRole] = useState<RecruitingRole>("STUDENT");
  const [signupPhone, setSignupPhone] = useState("");
  const [requestId, setRequestId] = useState("");
  const [requestNote, setRequestNote] = useState<string | null>(null);

  // 수강생(STUDENT) 화면 데이터
  const [myBadges, setMyBadges] = useState<MyBadge[]>([]);
  const [openJobs, setOpenJobs] = useState<FieldJob[]>([]);
  const [myApplications, setMyApplications] = useState<MyApplication[]>([]);

  // 전문가(EXPERT) 화면 데이터
  const [badges, setBadges] = useState<SkillBadge[]>([]);
  const [myJobs, setMyJobs] = useState<FieldJob[]>([]);
  const [applicantsByJob, setApplicantsByJob] = useState<Record<number, Applicant[]>>({});
  const [openApplicantsFor, setOpenApplicantsFor] = useState<number | null>(null);
  const [newLocation, setNewLocation] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newPay, setNewPay] = useState("");
  const [newBadgeId, setNewBadgeId] = useState<number | "">("");

  const enter = useCallback(async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const profile = await recruitingMe(c);
      try {
        localStorage.setItem(CODE_KEY, c);
      } catch {}
      setCode(c);
      setMe(profile);
    } catch (err) {
      setMe(null);
      setError(err instanceof Error ? err.message : "입장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const saved = readSaved();
    if (saved) {
      void enter(saved);
      return;
    }
    const rid = readRequestId();
    if (rid) setRequestId(rid);
  }, [enter]);

  // 승인 대기 중이면 8초마다 상태를 확인한다.
  useEffect(() => {
    if (!requestId || me) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await recruitingSignupStatus(requestId);
        if (stop) return;
        if (r.approval_status === "APPROVED" && r.access_code) {
          try {
            localStorage.setItem(CODE_KEY, r.access_code);
          } catch {}
          writeRequestId("");
          setRequestId("");
          setRequestNote(null);
          void enter(r.access_code);
        } else if (r.approval_status === "REJECTED") {
          writeRequestId("");
          setRequestId("");
          setRequestNote("승인되지 않았어요. 관리자에게 문의해 주세요.");
        }
      } catch {
        if (!stop) {
          writeRequestId("");
          setRequestId("");
        }
      }
    };
    void check();
    const t = setInterval(check, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [requestId, me, enter]);

  async function requestAccess() {
    const n = signupName.trim();
    if (!n || !signupPhone.trim()) return;
    setBusy(true);
    setError(null);
    setRequestNote(null);
    try {
      const r = await recruitingSignup({ name: n, role: signupRole, phone_number: signupPhone.trim() });
      writeRequestId(r.request_token);
      setRequestId(r.request_token);
      setSignupName("");
      setSignupPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function cancelRequest() {
    writeRequestId("");
    setRequestId("");
  }

  function logout() {
    try {
      localStorage.removeItem(CODE_KEY);
    } catch {}
    setMe(null);
    setCode("");
  }

  // 로그인 후 역할에 맞는 데이터를 불러온다.
  useEffect(() => {
    if (!me || !code) return;
    if (me.role === "STUDENT") {
      void recruitingMyBadges(code).then(setMyBadges).catch(() => {});
      void recruitingOpenJobs(code).then(setOpenJobs).catch(() => {});
      void recruitingMyApplications(code).then(setMyApplications).catch(() => {});
    } else if (me.role === "EXPERT") {
      void recruitingBadges(code).then(setBadges).catch(() => {});
      void recruitingMyJobs(code).then(setMyJobs).catch(() => {});
    }
  }, [me, code]);

  async function refreshStudentData() {
    if (!code) return;
    setOpenJobs(await recruitingOpenJobs(code));
    setMyApplications(await recruitingMyApplications(code));
  }

  async function apply(jobId: number) {
    setBusy(true);
    setError(null);
    try {
      await recruitingApply(code, jobId);
      await refreshStudentData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "지원하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createJob() {
    if (!newLocation.trim() || !newDate || !newPay || newBadgeId === "") return;
    setBusy(true);
    setError(null);
    try {
      await recruitingCreateJob(code, {
        location: newLocation.trim(),
        job_date: new Date(newDate).toISOString(),
        required_badge_id: Number(newBadgeId),
        pay: Number(newPay),
      });
      setNewLocation("");
      setNewDate("");
      setNewPay("");
      setNewBadgeId("");
      setMyJobs(await recruitingMyJobs(code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleApplicants(jobId: number) {
    if (openApplicantsFor === jobId) {
      setOpenApplicantsFor(null);
      return;
    }
    setOpenApplicantsFor(jobId);
    try {
      const list = await recruitingApplicants(code, jobId);
      setApplicantsByJob((prev) => ({ ...prev, [jobId]: list }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "지원자를 불러오지 못했습니다.");
    }
  }

  async function decide(jobId: number, applicationId: number, status: "APPROVED" | "REJECTED") {
    setBusy(true);
    setError(null);
    try {
      await recruitingDecide(code, jobId, applicationId, status);
      const [jobs, applicants] = await Promise.all([recruitingMyJobs(code), recruitingApplicants(code, jobId)]);
      setMyJobs(jobs);
      setApplicantsByJob((prev) => ({ ...prev, [jobId]: applicants }));
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
          <Link href="/" aria-label="처음으로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[17px] font-bold tracking-tight">현장 실습 매칭</h1>
          {me && (
            <div className="ml-auto flex items-center gap-2">
              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-[13px] font-bold text-white">
                {me.name.slice(0, 1)}
              </span>
              <button onClick={logout} className="flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-slate-500 transition hover:bg-white">
                <LogOut className="h-4 w-4" />
                나가기
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-6 px-4 pt-4">
        {!me && requestId ? (
          <section className={`${CARD} space-y-4 text-center`}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            </div>
            <div>
              <p className="text-[17px] font-bold">승인을 기다리고 있어요</p>
              <p className="mt-1 text-[14px] leading-relaxed text-slate-500 break-keep">
                관리자가 승인하면 자동으로 들어갑니다. 이 화면을 닫지 않아도 돼요.
              </p>
            </div>
            <button onClick={cancelRequest} className="h-12 w-full rounded-xl bg-slate-100 text-[15px] font-semibold text-slate-700 transition hover:bg-slate-200">
              요청 취소
            </button>
          </section>
        ) : !me && mode === "signup" ? (
          <section className={`${CARD} space-y-4`}>
            <div>
              <p className="text-[18px] font-bold tracking-tight">가입 신청</p>
              <p className="mt-1 text-[14px] leading-relaxed text-slate-500 break-keep">
                현장 실습 매칭은 승인된 사람만 쓸 수 있어요. 정보를 입력하면 관리자가 확인한 뒤 승인합니다.
              </p>
            </div>
            <div className="flex gap-2">
              {(["STUDENT", "EXPERT"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setSignupRole(r)}
                  className={`h-11 flex-1 rounded-xl text-[14px] font-semibold transition ${
                    signupRole === r ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {r === "STUDENT" ? "수강생" : "전문가"}
                </button>
              ))}
            </div>
            <input className={INPUT} value={signupName} onChange={(e) => setSignupName(e.target.value)} placeholder="이름" maxLength={30} autoComplete="name" />
            <input
              className={INPUT}
              value={signupPhone}
              onChange={(e) => setSignupPhone(e.target.value)}
              placeholder="전화번호 (예: 010-1234-5678)"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            <button disabled={busy || !signupName.trim() || !signupPhone.trim()} onClick={requestAccess} className={PRIMARY}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "승인 요청 보내기"}
            </button>
            <button onClick={() => setMode("code")} className="w-full py-2 text-[14px] font-medium text-slate-500 underline underline-offset-4">
              이미 받은 코드가 있어요
            </button>
            {requestNote && <p className="text-[14px] font-semibold text-rose-700">{requestNote}</p>}
            {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
          </section>
        ) : !me ? (
          <section className={`${CARD} space-y-4`}>
            <div>
              <p className="text-[18px] font-bold tracking-tight">접근 코드로 입장</p>
              <p className="mt-1 text-[14px] text-slate-500 break-keep">관리자에게 받은 코드를 입력하면 바로 들어갈 수 있어요.</p>
            </div>
            <input
              className={INPUT}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="접근 코드"
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && codeInput && enter(codeInput.trim())}
            />
            <button disabled={busy || !codeInput.trim()} onClick={() => enter(codeInput.trim())} className={PRIMARY}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "입장하기"}
            </button>
            <button onClick={() => setMode("signup")} className="w-full py-2 text-[14px] font-medium text-slate-500 underline underline-offset-4">
              코드가 없어요 (가입 신청하기)
            </button>
            {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
          </section>
        ) : (
          <>
            <section className="relative overflow-hidden rounded-3xl bg-indigo-600 p-6 text-white shadow-lg">
              <p className="text-[13px] font-medium text-indigo-100">{me.role === "EXPERT" ? "전문가" : "수강생"} 작업실</p>
              <h2 className="mt-1 text-[22px] font-bold tracking-tight">{me.name}님, 안녕하세요</h2>
            </section>

            {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}

            {me.role === "STUDENT" && (
              <>
                <section className="space-y-2">
                  <h2 className="px-1 text-[13px] font-bold uppercase tracking-wider text-slate-500">내 뱃지</h2>
                  {myBadges.length === 0 ? (
                    <EmptyCard>아직 획득한 뱃지가 없어요. 교육 수료 후 관리자가 지급해 드려요.</EmptyCard>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {myBadges.map((b) => (
                        <span key={b.badge_id} className="rounded-full bg-indigo-50 px-3 py-1.5 text-[13px] font-semibold text-indigo-700">
                          {b.badge_name}
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <h2 className="px-1 text-[13px] font-bold uppercase tracking-wider text-slate-500">모집중인 현장</h2>
                  {openJobs.length === 0 ? (
                    <EmptyCard>지금은 모집중인 현장이 없어요.</EmptyCard>
                  ) : (
                    openJobs.map((job) => {
                      const hasBadge = myBadges.some((b) => b.badge_id === job.required_badge_id);
                      const applied = myApplications.some((a) => a.job_id === job.id);
                      return (
                        <div key={job.id} className={CARD}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
                                <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                                {job.location}
                              </p>
                              <p className="mt-1 text-[13px] text-slate-500">{formatDate(job.job_date)}</p>
                              <p className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold tabular-nums text-slate-700">
                                <Wallet className="h-4 w-4 text-slate-400" />
                                {formatPay(job.pay)}
                              </p>
                              <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${hasBadge ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                                요구 뱃지: {job.required_badge_name}
                              </span>
                            </div>
                          </div>
                          <button
                            disabled={busy || !hasBadge || applied}
                            onClick={() => apply(job.id)}
                            className="mt-3 h-11 w-full rounded-xl bg-indigo-600 text-[14px] font-bold text-white disabled:opacity-40"
                          >
                            {applied ? "지원 완료" : hasBadge ? "지원하기" : "뱃지가 없어 지원할 수 없어요"}
                          </button>
                        </div>
                      );
                    })
                  )}
                </section>

                <section className="space-y-2">
                  <h2 className="px-1 text-[13px] font-bold uppercase tracking-wider text-slate-500">내 지원 내역</h2>
                  {myApplications.length === 0 ? (
                    <EmptyCard>아직 지원한 현장이 없어요.</EmptyCard>
                  ) : (
                    myApplications.map((a) => (
                      <div key={a.id} className={`${CARD} flex items-center justify-between gap-3`}>
                        <div>
                          <p className="text-[14px] font-semibold text-slate-900">{a.job_location}</p>
                          <p className="text-[13px] text-slate-500">{formatDate(a.job_date)} · {formatPay(a.job_pay)}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${APP_STATUS_TONE[a.status]}`}>
                          {APP_STATUS_LABEL[a.status]}
                        </span>
                      </div>
                    ))
                  )}
                </section>
              </>
            )}

            {me.role === "EXPERT" && (
              <>
                <section className={`${CARD} space-y-3`}>
                  <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
                    <Briefcase className="h-4 w-4" /> 새 현장 공고 올리기
                  </h2>
                  <input className={INPUT} value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="시공 현장 주소" />
                  <input type="datetime-local" className={INPUT} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                  <input
                    className={INPUT}
                    value={newPay}
                    onChange={(e) => setNewPay(e.target.value.replace(/\D/g, ""))}
                    placeholder="제시 일당 (원)"
                    inputMode="numeric"
                  />
                  <select
                    className={INPUT}
                    value={newBadgeId}
                    onChange={(e) => setNewBadgeId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">요구 뱃지 선택</option>
                    {badges.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.badge_name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || !newLocation.trim() || !newDate || !newPay || newBadgeId === ""}
                    onClick={createJob}
                    className={PRIMARY}
                  >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "공고 등록"}
                  </button>
                  {badges.length === 0 && (
                    <p className="text-[13px] text-slate-500 break-keep">아직 등록된 스킬 뱃지가 없어요. 관리자에게 뱃지 생성을 요청해 주세요.</p>
                  )}
                </section>

                <section className="space-y-2">
                  <h2 className="px-1 text-[13px] font-bold uppercase tracking-wider text-slate-500">내가 올린 공고</h2>
                  {myJobs.length === 0 ? (
                    <EmptyCard>아직 올린 공고가 없어요.</EmptyCard>
                  ) : (
                    myJobs.map((job) => (
                      <div key={job.id} className={CARD}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
                              <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                              {job.location}
                            </p>
                            <p className="mt-1 text-[13px] text-slate-500">{formatDate(job.job_date)} · {formatPay(job.pay)}</p>
                            <p className="mt-1 text-[12.5px] text-slate-500">요구 뱃지: {job.required_badge_name}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-600">
                            {JOB_STATUS_LABEL[job.status]}
                          </span>
                        </div>
                        <button
                          onClick={() => toggleApplicants(job.id)}
                          className="mt-3 h-11 w-full rounded-xl bg-slate-100 text-[14px] font-semibold text-slate-700"
                        >
                          지원자 보기
                        </button>
                        {openApplicantsFor === job.id && (
                          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                            {(applicantsByJob[job.id] ?? []).length === 0 ? (
                              <p className="text-[13px] text-slate-500">아직 지원자가 없어요.</p>
                            ) : (
                              (applicantsByJob[job.id] ?? []).map((a) => (
                                <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
                                  <div>
                                    <p className="text-[14px] font-semibold text-slate-900">{a.student_name}</p>
                                    <p className="text-[12.5px] text-slate-500">{a.student_phone}</p>
                                  </div>
                                  {a.status === "PENDING" ? (
                                    <div className="flex gap-1.5">
                                      <button
                                        disabled={busy}
                                        onClick={() => decide(job.id, a.id, "APPROVED")}
                                        className="flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-[13px] font-semibold text-white disabled:opacity-40"
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" /> 승인
                                      </button>
                                      <button
                                        disabled={busy}
                                        onClick={() => decide(job.id, a.id, "REJECTED")}
                                        className="flex h-9 items-center gap-1 rounded-lg bg-rose-50 px-3 text-[13px] font-semibold text-rose-700 disabled:opacity-40"
                                      >
                                        <XCircle className="h-3.5 w-3.5" /> 거절
                                      </button>
                                    </div>
                                  ) : (
                                    <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${APP_STATUS_TONE[a.status]}`}>
                                      {APP_STATUS_LABEL[a.status]}
                                    </span>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
