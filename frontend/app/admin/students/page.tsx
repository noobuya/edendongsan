"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, Trash2, UserPlus } from "lucide-react";
import { adminAddStudent, adminListStudents, adminRemoveStudent, type AdminStudent } from "@/lib/api";

/** 관리자 토큰은 이 브라우저 탭에만 임시로 둔다(탭을 닫으면 사라짐). */
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
  } catch {
    /* 저장이 막혀 있어도 이 화면에서는 계속 쓸 수 있다. */
  }
}

const input =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500";

export default function AdminStudentsPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<AdminStudent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load(t: string) {
    setBusy(true);
    setError(null);
    try {
      setStudents(await adminListStudents(t));
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

  // 같은 탭에서 새로고침해도 토큰을 다시 묻지 않도록 한다.
  useEffect(() => {
    const saved = readToken();
    if (saved) void load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const row = await adminAddStudent(token, trimmed);
      setCreated(row);
      setName("");
      setStudents(await adminListStudents(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(target: string) {
    if (!window.confirm(`${target} 학생의 코드를 삭제할까요? 이 코드로는 더 이상 입장할 수 없습니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      await adminRemoveStudent(token, target);
      if (created?.name === target) setCreated(null);
      setStudents(await adminListStudents(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.");
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
            onKeyDown={(e) => e.key === "Enter" && tokenInput && load(tokenInput.trim())}
          />
          <button
            disabled={busy || !tokenInput.trim()}
            onClick={() => load(tokenInput.trim())}
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
        <h1 className="text-xl font-bold text-slate-900">수강생 코드 관리</h1>
        <button
          onClick={() => {
            writeToken("");
            setAuthorized(false);
            setToken("");
            setStudents([]);
            setCreated(null);
          }}
          className="text-[14px] text-slate-500 underline"
        >
          나가기
        </button>
      </header>

      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
          <UserPlus className="h-4 w-4" /> 새 수강생 추가
        </h2>
        <div className="flex gap-2">
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="수강생 이름"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button
            disabled={busy || !name.trim()}
            onClick={handleAdd}
            className="h-12 shrink-0 rounded-xl bg-indigo-600 px-5 text-[15px] font-bold text-white disabled:opacity-40"
          >
            만들기
          </button>
        </div>

        {created && created.code && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <p className="text-[13px] text-indigo-800">{created.name} 학생의 코드입니다. 지금 복사해서 전달하세요.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg bg-white px-3 py-2 text-[16px] font-bold tabular-nums text-slate-900">
                {created.code}
              </code>
              <button
                onClick={() => copy(created.code as string, "new")}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-[14px] font-semibold text-indigo-700"
              >
                <Copy className="h-4 w-4" />
                {copied === "new" ? "복사됨" : "복사"}
              </button>
            </div>
          </div>
        )}
      </section>

      {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 px-1 text-[15px] font-bold text-slate-700">
          <KeyRound className="h-4 w-4" /> 등록된 수강생 {students.length}명
        </h2>
        {students.length === 0 && <p className="px-1 text-[14px] text-slate-500">아직 등록된 수강생이 없어요.</p>}
        {students.map((s) => (
          <div key={`${s.source}-${s.name}`} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-slate-900">
                {s.name} <span className="ml-1 text-[12px] font-normal text-slate-500">{s.source}</span>
              </p>
              {s.code ? (
                <p className="mt-0.5 break-all font-mono text-[13px] text-slate-600">{s.code}</p>
              ) : (
                <p className="mt-0.5 text-[13px] text-slate-400">코드는 서버 설정 파일에서 확인</p>
              )}
            </div>
            {s.code && (
              <button
                onClick={() => copy(s.code as string, s.name)}
                aria-label={`${s.name} 코드 복사`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700"
              >
                <Copy className="h-4 w-4" />
              </button>
            )}
            {s.source === "관리자" && (
              <button
                onClick={() => handleRemove(s.name)}
                disabled={busy}
                aria-label={`${s.name} 삭제`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-700 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
