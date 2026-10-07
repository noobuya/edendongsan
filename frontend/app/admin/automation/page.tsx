"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import {
  adminAutomationFeedback,
  adminAutomationJobs,
  adminAutomationRerun,
  adminAutomationTasks,
  adminAutomationUpdateFeedback,
  adminDeleteJournalEntry,
  adminListJournalEntries,
  type AdminAutomationJob,
  type AutomationFeedback,
  type AutomationTask,
  type FeedbackStatus,
} from "@/lib/api";
import type { JournalEntry } from "@/types";
import { FEEDBACK_KIND_LABEL } from "@/components/automation/FeedbackForm";

/** 관리자 토큰은 이 탭에만 임시로 둔다(/admin/students와 같은 방식). */
const TOKEN_KEY = "eden-admin-token";

const FEEDBACK_STATUSES: { value: FeedbackStatus; label: string }[] = [
  { value: "received", label: "접수됨" },
  { value: "reviewing", label: "검토 중" },
  { value: "done", label: "반영 완료" },
  { value: "hold", label: "보류" },
];

const JOB_STATUS_LABEL: Record<AdminAutomationJob["status"], string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  failed: "실패",
  canceled: "취소",
};

const input =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500";

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

function fmt(sec: number | null): string {
  return sec ? new Date(sec * 1000).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
}

export default function AdminAutomationPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [tab, setTab] = useState<"jobs" | "feedback" | "journal">("feedback");
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [jobs, setJobs] = useState<AdminAutomationJob[]>([]);
  const [feedback, setFeedback] = useState<AutomationFeedback[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(t: string) {
    setBusy(true);
    setError(null);
    try {
      const [tk, jb, fb, jn] = await Promise.all([
        adminAutomationTasks(t),
        adminAutomationJobs(t),
        adminAutomationFeedback(t),
        adminListJournalEntries(t),
      ]);
      setTasks(tk);
      setJobs(jb);
      setFeedback(fb);
      setJournal(jn);
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
    if (saved) void load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const [jb, fb, jn] = await Promise.all([
        adminAutomationJobs(token),
        adminAutomationFeedback(token),
        adminListJournalEntries(token),
      ]);
      setJobs(jb);
      setFeedback(fb);
      setJournal(jn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "새로고침하지 못했습니다.");
    }
  }

  if (!authorized) {
    return (
      <main className="min-h-dvh bg-[#f2f4f6] px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold">자동화 로그 · 피드백</h1>
          <input
            type="password"
            className={input}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="관리자 토큰"
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && tokenInput && load(tokenInput)}
          />
          <button
            disabled={busy || !tokenInput}
            onClick={() => load(tokenInput)}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "들어가기"}
          </button>
          {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
        </div>
      </main>
    );
  }

  const newFeedback = feedback.filter((f) => f.status === "received").length;

  return (
    <main className="min-h-dvh bg-[#f2f4f6] pb-16 text-slate-900">
      <header className="mx-auto flex max-w-3xl items-center gap-3 px-4 pb-2 pt-5">
        <Link href="/admin/students" aria-label="수강생 관리로" className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold">자동화 로그 · 피드백</h1>
        <button onClick={refresh} aria-label="새로고침" className="ml-auto flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
          <RefreshCw className="h-5 w-5" />
        </button>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4">
        <nav className="flex gap-2">
          <button
            onClick={() => setTab("feedback")}
            className={`h-11 flex-1 rounded-xl text-[15px] font-semibold ${tab === "feedback" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 shadow-sm"}`}
          >
            피드백 {newFeedback > 0 && <span className="ml-1 rounded-full bg-rose-500 px-2 py-0.5 text-[12px] text-white">{newFeedback}</span>}
          </button>
          <button
            onClick={() => setTab("jobs")}
            className={`h-11 flex-1 rounded-xl text-[15px] font-semibold ${tab === "jobs" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 shadow-sm"}`}
          >
            작업 로그
          </button>
          <button
            onClick={() => setTab("journal")}
            className={`h-11 flex-1 rounded-xl text-[15px] font-semibold ${tab === "journal" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 shadow-sm"}`}
          >
            작업 일지
          </button>
        </nav>

        {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}

        {tab === "feedback" && (
          <section className="space-y-3">
            {feedback.length === 0 && <p className="px-1 text-[14px] text-slate-500">아직 들어온 피드백이 없어요.</p>}
            {feedback.map((fb) => (
              <FeedbackCard key={fb.id} fb={fb} token={token} tasks={tasks} onSaved={(next) => setFeedback(feedback.map((f) => (f.id === next.id ? next : f)))} onError={setError} />
            ))}
          </section>
        )}

        {tab === "jobs" && (
          <section className="space-y-3">
            {jobs.length === 0 && <p className="px-1 text-[14px] text-slate-500">아직 실행된 작업이 없어요.</p>}
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} token={token} tasks={tasks} onRerun={() => void refresh()} onError={setError} />
            ))}
          </section>
        )}

        {tab === "journal" && (
          <section className="space-y-3">
            {journal.length === 0 && <p className="px-1 text-[14px] text-slate-500">아직 쓴 일지가 없어요.</p>}
            {journal.map((entry) => (
              <JournalAdminCard
                key={entry.id}
                entry={entry}
                token={token}
                onDeleted={(id) => setJournal((prev) => prev.filter((e) => e.id !== id))}
                onError={setError}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function FeedbackCard({
  fb,
  token,
  tasks,
  onSaved,
  onError,
}: {
  fb: AutomationFeedback;
  token: string;
  tasks: AutomationTask[];
  onSaved: (next: AutomationFeedback) => void;
  onError: (msg: string) => void;
}) {
  const [status, setStatus] = useState<FeedbackStatus>(fb.status);
  const [note, setNote] = useState(fb.admin_note);
  const [saving, setSaving] = useState(false);
  const taskTitle = fb.context.task ? tasks.find((t) => t.id === fb.context.task)?.title ?? fb.context.task : null;
  const dirty = status !== fb.status || note !== fb.admin_note;

  async function save() {
    setSaving(true);
    try {
      onSaved(await adminAutomationUpdateFeedback(token, fb.id, status, note.trim()));
    } catch (e) {
      onError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-bold text-slate-900">{fb.owner}</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{FEEDBACK_KIND_LABEL[fb.kind]}</span>
        {taskTitle && <span className="text-slate-500">· {taskTitle}</span>}
        <span className="ml-auto text-slate-400">{fmt(fb.created)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-[15px] text-slate-800">{fb.message}</p>

      {fb.job_id && (
        <details className="text-[13px] text-slate-600">
          <summary className="cursor-pointer font-semibold">작업 정보 보기 ({fb.context.status ?? "-"})</summary>
          {fb.context.error && <p className="mt-2 text-rose-700">오류: {fb.context.error}</p>}
          {fb.context.params && Object.keys(fb.context.params).length > 0 && (
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2">{JSON.stringify(fb.context.params, null, 2)}</pre>
          )}
          {fb.context.log_tail && fb.context.log_tail.length > 0 && (
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-2 text-slate-100">{fb.context.log_tail.join("\n")}</pre>
          )}
        </details>
      )}

      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <select className={input} value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
          {FEEDBACK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input className={input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="수강생에게 보일 답변 (선택)" />
      </div>
      <button
        disabled={!dirty || saving}
        onClick={save}
        className="flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "저장"}
      </button>
    </article>
  );
}

function JobCard({
  job,
  token,
  tasks,
  onRerun,
  onError,
}: {
  job: AdminAutomationJob;
  token: string;
  tasks: AutomationTask[];
  onRerun: () => void;
  onError: (msg: string) => void;
}) {
  const task = tasks.find((t) => t.id === job.task);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function startEdit() {
    // 비밀값(secret)은 저장되어 있지 않으므로 빈칸으로 두고 다시 입력받는다.
    const init: Record<string, string> = {};
    for (const f of task?.fields ?? []) {
      if (!f.secret) init[f.key] = job.params[f.key] ?? "";
    }
    setValues(init);
    setDone(null);
    setEditing(true);
  }

  async function rerun() {
    setBusy(true);
    try {
      await adminAutomationRerun(token, job.id, values);
      setEditing(false);
      setDone("같은 학생 이름으로 새 작업을 대기열에 넣었어요.");
      onRerun();
    } catch (e) {
      onError(e instanceof Error ? e.message : "다시 실행하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="font-bold text-slate-900">{job.owner}</span>
        <span className="text-slate-700">{task?.title ?? job.task}</span>
        <span
          className={`ml-auto font-semibold ${
            job.status === "done" ? "text-emerald-700" : job.status === "failed" ? "text-rose-700" : "text-slate-500"
          }`}
        >
          {JOB_STATUS_LABEL[job.status]}
        </span>
      </div>
      <p className="text-[13px] text-slate-400">{fmt(job.created)} 접수</p>
      {job.error && <p className="text-[14px] font-semibold text-rose-700">오류: {job.error}</p>}

      <button onClick={() => setOpen(!open)} className="h-10 text-[14px] font-semibold text-indigo-600">
        {open ? "로그 닫기" : "전체 로그 보기"}
      </button>
      {open && (
        <>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900 p-3 text-[12px] text-slate-100">
            {job.log.length ? job.log.join("\n") : "(로그 없음)"}
          </pre>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
            {JSON.stringify(job.params, null, 2)}
          </pre>
        </>
      )}

      {(job.status === "failed" || job.status === "done") && task && !editing && (
        <button onClick={startEdit} className="h-11 w-full rounded-xl bg-slate-100 text-[15px] font-semibold text-slate-800">
          값을 고쳐서 다시 실행
        </button>
      )}
      {done && <p className="text-[14px] font-semibold text-emerald-700">{done}</p>}

      {editing && task && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          {task.fields.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-[13px] font-semibold text-slate-700">
                {f.label}
                {f.secret && <span className="ml-1 font-normal text-rose-600">(다시 입력)</span>}
              </span>
              <input
                className={input}
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="h-12 flex-1 rounded-xl bg-white text-[15px] font-semibold text-slate-700 shadow-sm">
              취소
            </button>
            <button
              disabled={busy}
              onClick={rerun}
              className="flex h-12 flex-1 items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "이 값으로 실행"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function JournalAdminCard({
  entry,
  token,
  onDeleted,
  onError,
}: {
  entry: JournalEntry;
  token: string;
  onDeleted: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    try {
      await adminDeleteJournalEntry(token, entry.id);
      onDeleted(entry.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <article className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="font-bold text-slate-900">{entry.owner}</span>
        <span className="text-slate-700">{entry.title}</span>
        <span className="ml-auto text-[13px] text-slate-400">{fmt(entry.created)}</span>
      </div>
      {entry.content && (
        <button onClick={() => setOpen(!open)} className="block w-full text-left">
          <p className={`whitespace-pre-wrap break-words text-[13px] text-slate-600 ${open ? "" : "line-clamp-2"}`}>
            {entry.content}
          </p>
        </button>
      )}
      {entry.photos.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {entry.photos.map((p) => (
            <AssetImage key={p.id} src={p.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
      )}
      <button
        onClick={handleDelete}
        disabled={deleting}
        className={`flex h-10 items-center gap-1 text-[13px] font-semibold disabled:opacity-50 ${
          confirming ? "text-red-600" : "text-slate-400 hover:text-red-500"
        }`}
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : confirming ? "한 번 더 누르면 삭제" : "삭제"}
      </button>
    </article>
  );
}
