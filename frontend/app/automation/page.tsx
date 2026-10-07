"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, BookOpen, ChevronDown, Clock, Loader2, LogOut, MessageSquare, Sparkles } from "lucide-react";
import {
  automationCancel,
  automationCreate,
  automationJobs,
  automationLogin,
  automationRequestAccess,
  automationRequestStatus,
  automationTasks,
  type AutomationJob,
  type AutomationTask,
} from "@/lib/api";
import FeedbackForm from "@/components/automation/FeedbackForm";

const CODE_KEY = "eden-automation-code";
// 승인 요청을 보낸 기기의 요청 번호. 이 번호로만 자기 요청 상태를 확인한다.
const REQUEST_KEY = "eden-automation-request";

const INPUT =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20";
const CARD = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70";
const PRIMARY =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[15px] font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40";

// 작업 상태별 색. 점과 알약 색을 같이 써서 목록을 훑어볼 때 바로 구분되게 한다.
const TONE: Record<AutomationJob["status"], { dot: string; pill: string }> = {
  queued: { dot: "bg-slate-300", pill: "bg-slate-100 text-slate-600" },
  running: { dot: "bg-indigo-500", pill: "bg-indigo-50 text-indigo-700" },
  done: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700" },
  failed: { dot: "bg-rose-500", pill: "bg-rose-50 text-rose-700" },
  canceled: { dot: "bg-slate-300", pill: "bg-slate-100 text-slate-500" },
};

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

function statusLabel(job: AutomationJob): string {
  switch (job.status) {
    case "queued":
      return job.position && job.position > 1 ? `대기 중 · 앞에 ${job.position - 1}건` : "곧 시작해요";
    case "running":
      return "진행 중";
    case "done":
      return "완료";
    case "failed":
      return "실패";
    default:
      return "취소됨";
  }
}

/** "방금 전", "3분 전", "2시간 전", 하루가 넘으면 날짜. created는 초 단위 유닉스 시각이다. */
function timeAgo(sec: number): string {
  const diff = Date.now() / 1000 - sec;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return new Date(sec * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="px-1 text-[13px] font-bold uppercase tracking-wider text-slate-500">{children}</h2>;
}

function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <Sparkles className="h-6 w-6 text-slate-400" />
      <p className="text-[14px] leading-relaxed text-slate-500 break-keep">{children}</p>
    </div>
  );
}

export default function AutomationPage() {
  const [code, setCode] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [taskId, setTaskId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [feedbackJobId, setFeedbackJobId] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 코드가 없는 학생: 이름으로 승인을 요청하거나(signup), 이미 받은 코드를 입력한다(code).
  const [mode, setMode] = useState<"signup" | "code">("signup");
  const [codeInput, setCodeInput] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupBirth, setSignupBirth] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupConsent, setSignupConsent] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [requestNote, setRequestNote] = useState<string | null>(null);

  const enter = useCallback(async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const me = await automationLogin(c);
      const list = await automationTasks(c);
      try {
        localStorage.setItem(CODE_KEY, c);
      } catch {}
      setCode(c);
      setName(me.name);
      setTasks(list);
      setTaskId((prev) => prev || list[0]?.id || "");
    } catch (err) {
      setName(null);
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

  // 승인 대기 중이면 8초마다 상태를 확인한다. 승인되면 코드가 이 기기에 저장되고 바로 입장한다.
  useEffect(() => {
    if (!requestId || name) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await automationRequestStatus(requestId);
        if (stop) return;
        if (r.status === "approved" && r.code) {
          try {
            localStorage.setItem(CODE_KEY, r.code);
          } catch {}
          writeRequestId("");
          setRequestId("");
          setRequestNote(null);
          void enter(r.code);
        } else if (r.status === "rejected") {
          writeRequestId("");
          setRequestId("");
          setRequestNote("승인되지 않았어요. 선생님께 문의해 주세요.");
        }
      } catch {
        // 요청 번호를 찾을 수 없으면(서버 초기화 등) 다시 요청할 수 있게 비운다.
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
  }, [requestId, name, enter]);

  async function requestAccess() {
    const n = signupName.trim();
    if (!n || !signupBirth || !signupPhone.trim() || !signupConsent) return;
    setBusy(true);
    setError(null);
    setRequestNote(null);
    try {
      const r = await automationRequestAccess({
        name: n,
        birth: signupBirth,
        phone: signupPhone.trim(),
        consent: signupConsent,
      });
      writeRequestId(r.id);
      setRequestId(r.id);
      setSignupName("");
      setSignupBirth("");
      setSignupPhone("");
      setSignupConsent(false);
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

  // 대기 중이거나 실행 중인 작업이 있으면 3초마다 상태를 다시 확인한다.
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!name) return;
    let stop = false;
    const load = () =>
      automationJobs(code)
        .then((j) => {
          if (stop) return;
          setJobs(j);
          setJobsLoaded(true);
        })
        .catch(() => {});
    void load();
    if (!active) return () => { stop = true; };
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [name, code, active]);

  const task = tasks.find((t) => t.id === taskId);
  const runningCount = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const doneCount = jobs.filter((j) => j.status === "done").length;

  async function submit() {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      await automationCreate(code, task.id, values);
      setValues({});
      setJobs(await automationJobs(code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      await automationCancel(code, id);
      setJobs(await automationJobs(code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "취소하지 못했습니다.");
    }
  }

  function logout() {
    try {
      localStorage.removeItem(CODE_KEY);
    } catch {}
    setName(null);
    setCode("");
    setJobs([]);
    setJobsLoaded(false);
  }

  return (
    <main className="min-h-dvh bg-[#f2f4f6] pb-20 text-slate-900">
      <header className="sticky top-0 z-10 bg-[#f2f4f6]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4">
          <Link
            href="/"
            aria-label="처음으로"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[17px] font-bold tracking-tight">자동화 작업</h1>
          {name && (
            <div className="ml-auto flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-[13px] font-bold text-white"
              >
                {name.slice(0, 1)}
              </span>
              <Link
                href="/automation/journal"
                className="flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-slate-500 transition hover:bg-white"
              >
                <BookOpen className="h-4 w-4" />
                내 작업 일지
              </Link>
              <button
                onClick={logout}
                className="flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-slate-500 transition hover:bg-white"
              >
                <LogOut className="h-4 w-4" />
                나가기
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-6 px-4 pt-4">
        {!name && requestId ? (
          <section className={`${CARD} space-y-4 text-center`}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            </div>
            <div>
              <p className="text-[17px] font-bold">승인을 기다리고 있어요</p>
              <p className="mt-1 text-[14px] leading-relaxed text-slate-500 break-keep">
                선생님이 승인하면 자동으로 들어갑니다. 이 화면을 닫지 않아도 돼요.
              </p>
            </div>
            <button onClick={cancelRequest} className="h-12 w-full rounded-xl bg-slate-100 text-[15px] font-semibold text-slate-700 transition hover:bg-slate-200">
              요청 취소
            </button>
          </section>
        ) : !name && mode === "signup" ? (
          <section className={`${CARD} space-y-4`}>
            <div>
              <p className="text-[18px] font-bold tracking-tight">수강생 승인 요청</p>
              <p className="mt-1 text-[14px] leading-relaxed text-slate-500 break-keep">
                자동화 작업은 승인된 수강생만 쓸 수 있어요. 정보를 입력하면 선생님이 확인한 뒤 승인합니다.
              </p>
            </div>
            <input className={INPUT} value={signupName} onChange={(e) => setSignupName(e.target.value)} placeholder="이름" maxLength={20} autoComplete="name" />
            <div>
              <p className="mb-1 text-[13px] text-slate-500">생년월일</p>
              <input
                type="date"
                className={INPUT}
                value={signupBirth}
                onChange={(e) => setSignupBirth(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <input
              className={INPUT}
              value={signupPhone}
              onChange={(e) => setSignupPhone(e.target.value)}
              placeholder="전화번호 (예: 010-1234-5678)"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-600">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
                checked={signupConsent}
                onChange={(e) => setSignupConsent(e.target.checked)}
              />
              <span className="break-keep">
                이름·생년월일·전화번호를 수강생 확인과 승인 목적으로 수집하는 데 동의합니다. 관리자만 볼 수 있으며, 수강이 끝나면 요청하실 때 삭제합니다.
              </span>
            </label>
            <button
              disabled={busy || !signupName.trim() || !signupBirth || !signupPhone.trim() || !signupConsent}
              onClick={requestAccess}
              className={PRIMARY}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "승인 요청 보내기"}
            </button>
            <button onClick={() => setMode("code")} className="w-full py-2 text-[14px] font-medium text-slate-500 underline underline-offset-4">
              이미 받은 코드가 있어요
            </button>
            {requestNote && <p className="text-[14px] font-semibold text-rose-700">{requestNote}</p>}
          </section>
        ) : !name ? (
          <section className={`${CARD} space-y-4`}>
            <div>
              <p className="text-[18px] font-bold tracking-tight">수강생 코드로 입장</p>
              <p className="mt-1 text-[14px] text-slate-500 break-keep">선생님께 받은 코드를 입력하면 바로 들어갈 수 있어요.</p>
            </div>
            <input
              className={INPUT}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="수강생 코드"
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && codeInput && enter(codeInput.trim())}
            />
            <button disabled={busy || !codeInput.trim()} onClick={() => enter(codeInput.trim())} className={PRIMARY}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "입장하기"}
            </button>
            <button onClick={() => setMode("signup")} className="w-full py-2 text-[14px] font-medium text-slate-500 underline underline-offset-4">
              코드가 없어요 (승인 요청하기)
            </button>
          </section>
        ) : (
          <>
            <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 p-6 text-white shadow-lg">
              <p className="text-[13px] font-medium text-indigo-100">수강생 작업실</p>
              <h2 className="mt-1 text-[22px] font-bold tracking-tight">{name}님, 안녕하세요</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-indigo-100 break-keep">
                작업을 골라 요청하면 순서대로 처리돼요. 진행 상황은 아래 목록에서 바로 볼 수 있어요.
              </p>
              <dl className="mt-5 grid grid-cols-3 gap-2">
                {[
                  { label: "진행 중", value: runningCount },
                  { label: "완료", value: doneCount },
                  { label: "전체", value: jobs.length },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl bg-white/10 px-3 py-3 text-center">
                    <dt className="text-[12px] text-indigo-100">{s.label}</dt>
                    <dd className="mt-0.5 text-[20px] font-bold tabular-nums">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="space-y-3">
              <SectionTitle>작업 고르기</SectionTitle>
              {tasks.length === 0 ? (
                <EmptyCard>지금 열려 있는 작업이 없어요.</EmptyCard>
              ) : (
                <div className="grid gap-2">
                  {tasks.map((t) => {
                    const selected = t.id === taskId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setTaskId(t.id);
                          setValues({});
                        }}
                        className={`flex items-start gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition ${
                          selected ? "ring-2 ring-indigo-600" : "ring-1 ring-slate-200/70 hover:ring-slate-300"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                            selected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          <Bot className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[15px] font-bold">{t.title}</span>
                          <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500 break-keep">{t.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {task && (
              <section className={`${CARD} space-y-4`}>
                <div>
                  <p className="text-[12px] font-semibold text-indigo-600">선택한 작업</p>
                  <h3 className="text-[17px] font-bold">{task.title}</h3>
                </div>
                {task.fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1.5 block text-[14px] font-semibold text-slate-700">
                      {f.label}
                      {!f.required && <span className="ml-1 font-normal text-slate-400">(선택)</span>}
                    </span>
                    {f.type === "textarea" ? (
                      <textarea
                        className={`${INPUT} h-28 py-3`}
                        value={values[f.key] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      />
                    ) : (
                      <input
                        className={INPUT}
                        type={f.type === "number" ? "text" : f.type}
                        inputMode={f.type === "number" ? "numeric" : undefined}
                        value={values[f.key] ?? ""}
                        placeholder={f.placeholder}
                        autoComplete="off"
                        onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      />
                    )}
                  </label>
                ))}
                <button disabled={busy} onClick={submit} className={PRIMARY}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "작업 요청하기"}
                </button>
                <p className="text-center text-[12px] text-slate-400">요청한 순서대로 처리돼요. 대기 중인 작업은 취소할 수 있어요.</p>
              </section>
            )}

            <section className="space-y-3">
              <SectionTitle>내 작업</SectionTitle>
              {!jobsLoaded ? (
                <div className="space-y-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/70" />
                  ))}
                </div>
              ) : jobs.length === 0 ? (
                <EmptyCard>아직 요청한 작업이 없어요. 위에서 작업을 고르고 요청해 보세요.</EmptyCard>
              ) : (
                jobs.map((job) => {
                  const taskTitle = tasks.find((t) => t.id === job.task)?.title ?? job.task;
                  const lastLog = job.log[job.log.length - 1];
                  return (
                    <article key={job.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
                      <div className="flex items-start gap-3">
                        <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${TONE[job.status].dot}`} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[15px] font-bold">{taskTitle}</h3>
                            <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${TONE[job.status].pill}`}>
                              {statusLabel(job)}
                            </span>
                          </div>
                          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-slate-400">
                            <Clock className="h-3 w-3" />
                            {timeAgo(job.created)} 요청
                          </p>
                        </div>
                      </div>

                      {job.status === "running" && (
                        <div className="mt-3">
                          <div className="h-1.5 overflow-hidden rounded-full bg-indigo-50">
                            <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-500" />
                          </div>
                          {lastLog && <p className="mt-2 text-[13px] text-slate-500">{lastLog}</p>}
                        </div>
                      )}

                      {job.error && (
                        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-[13px] leading-relaxed text-rose-700 break-keep">{job.error}</p>
                      )}

                      {job.result && (
                        <details className="group mt-3">
                          <summary className="flex cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-slate-600">
                            결과 보기
                            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-[12px] text-slate-700">
                            {JSON.stringify(job.result, null, 2)}
                          </pre>
                        </details>
                      )}

                      <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2">
                        {job.status === "queued" && (
                          <button onClick={() => cancel(job.id)} className="h-10 rounded-lg px-3 text-[13px] font-semibold text-rose-600 transition hover:bg-rose-50">
                            요청 취소
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setFeedbackJobId(feedbackJobId === job.id ? null : job.id);
                            setFeedbackNote(null);
                          }}
                          className="ml-auto flex h-10 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold text-indigo-600 transition hover:bg-indigo-50"
                        >
                          <MessageSquare className="h-4 w-4" />
                          의견 남기기
                        </button>
                      </div>

                      {feedbackJobId === job.id && (
                        <div className="mt-3">
                          <FeedbackForm
                            code={code}
                            jobId={job.id}
                            onSent={() => {
                              setFeedbackJobId(null);
                              setFeedbackNote("이 작업에 대한 의견을 보냈어요. 선생님이 확인할게요.");
                            }}
                          />
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </section>

            <details className={`group ${CARD}`}>
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">불편한 점·오류 알려주기</span>
                  <span className="block text-[13px] text-slate-500">작업과 상관없이 쓰면서 느낀 점을 남겨 주세요</span>
                </span>
                <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
              </summary>
              <div className="mt-4">
                <FeedbackForm code={code} onSent={() => setFeedbackNote("의견을 보냈어요. 감사합니다.")} />
              </div>
            </details>
            {feedbackNote && (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-[14px] font-semibold text-emerald-700">{feedbackNote}</p>
            )}
          </>
        )}

        {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-[14px] font-semibold text-rose-700">{error}</p>}
      </div>
    </main>
  );
}
