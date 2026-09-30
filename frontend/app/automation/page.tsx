"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import {
  automationCancel,
  automationCreate,
  automationJobs,
  automationLogin,
  automationTasks,
  type AutomationJob,
  type AutomationTask,
} from "@/lib/api";

const CODE_KEY = "eden-automation-code";

function readSaved(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

function statusLabel(job: AutomationJob): string {
  switch (job.status) {
    case "queued":
      return job.position && job.position > 1 ? `대기 중 (내 앞에 ${job.position - 1}건)` : "곧 시작해요";
    case "running":
      return "실행 중";
    case "done":
      return "완료";
    case "failed":
      return "실패";
    default:
      return "취소됨";
  }
}

export default function AutomationPage() {
  const [code, setCode] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [taskId, setTaskId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (saved) void enter(saved);
  }, [enter]);

  // 대기 중이거나 실행 중인 작업이 있으면 3초마다 상태를 다시 확인한다.
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!name) return;
    let stop = false;
    const load = () => automationJobs(code).then((j) => !stop && setJobs(j)).catch(() => {});
    void load();
    if (!active) return () => { stop = true; };
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [name, code, active]);

  const task = tasks.find((t) => t.id === taskId);

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
  }

  const input =
    "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20";

  return (
    <main className="min-h-dvh bg-[#f2f4f6] pb-16 text-slate-900">
      <header className="mx-auto flex max-w-xl items-center gap-3 px-4 pb-2 pt-5">
        <Link href="/" aria-label="처음으로" className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold">자동화 작업</h1>
        {name && (
          <button onClick={logout} className="ml-auto h-11 px-3 text-[13px] font-semibold text-slate-500">
            {name}님 · 나가기
          </button>
        )}
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-4">
        {!name ? (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="mb-3 text-[15px] text-slate-600">수강생 코드를 입력하면 입장할 수 있어요.</p>
            <input
              className={input}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="수강생 코드"
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && codeInput && enter(codeInput.trim())}
            />
            <button
              disabled={busy || !codeInput.trim()}
              onClick={() => enter(codeInput.trim())}
              className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "입장하기"}
            </button>
          </section>
        ) : (
          <>
            <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
              {tasks.length > 1 && (
                <select className={input} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              )}
              {task && (
                <>
                  <div>
                    <h2 className="text-[17px] font-bold">{task.title}</h2>
                    <p className="text-[14px] text-slate-500">{task.description}</p>
                  </div>
                  {task.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-[14px] font-semibold text-slate-700">
                        {f.label}
                        {!f.required && <span className="ml-1 font-normal text-slate-400">(선택)</span>}
                      </span>
                      {f.type === "textarea" ? (
                        <textarea
                          className={`${input} h-28 py-3`}
                          value={values[f.key] ?? ""}
                          placeholder={f.placeholder}
                          onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                        />
                      ) : (
                        <input
                          className={input}
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
                  <button
                    disabled={busy}
                    onClick={submit}
                    className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "실행하기"}
                  </button>
                </>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="px-1 text-[15px] font-bold text-slate-700">내 작업</h2>
              {jobs.length === 0 && <p className="px-1 text-[14px] text-slate-500">아직 요청한 작업이 없어요.</p>}
              {jobs.map((job) => (
                <article key={job.id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    {job.status === "done" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : job.status === "failed" || job.status === "canceled" ? (
                      <XCircle className="h-5 w-5 text-rose-600" />
                    ) : job.status === "running" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                    ) : (
                      <Clock className="h-5 w-5 text-slate-400" />
                    )}
                    <span className="text-[15px] font-bold">{tasks.find((t) => t.id === job.task)?.title ?? job.task}</span>
                    <span className="ml-auto text-[13px] font-semibold text-slate-500">{statusLabel(job)}</span>
                  </div>
                  {job.status === "running" && job.log.length > 0 && (
                    <p className="mt-2 text-[13px] text-slate-500">{job.log[job.log.length - 1]}</p>
                  )}
                  {job.error && <p className="mt-2 text-[14px] text-rose-700">{job.error}</p>}
                  {job.result && (
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-[13px] text-slate-700">
                      {JSON.stringify(job.result, null, 2)}
                    </pre>
                  )}
                  {job.status === "queued" && (
                    <button onClick={() => cancel(job.id)} className="mt-2 h-11 text-[14px] font-semibold text-rose-600">
                      취소
                    </button>
                  )}
                </article>
              ))}
            </section>
          </>
        )}

        {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}
      </div>
    </main>
  );
}
