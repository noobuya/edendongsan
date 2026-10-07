"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, ImageIcon, Loader2, LogOut, Plus } from "lucide-react";
import {
  automationLogin,
  automationRequestAccess,
  automationRequestStatus,
  createJournalEntry,
  listJournalEntries,
} from "@/lib/api";
import type { JournalEntry } from "@/types";

// /automation과 같은 키 — 거기서 이미 로그인했다면 여기서도 바로 들어간다.
const CODE_KEY = "eden-automation-code";
const REQUEST_KEY = "eden-automation-request";

const INPUT =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20";
const CARD = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70";
const PRIMARY =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[15px] font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40";

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

function formatDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 개인 작업 일지 — 본인(수강생 코드)과 관리자만 보는 비공개 기록. /automation과
 *  같은 로그인 흐름을 그대로 쓴다(코드가 저장돼 있으면 자동 입장). */
export default function JournalPage() {
  const [code, setCode] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signup" | "code">("signup");
  const [codeInput, setCodeInput] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupBirth, setSignupBirth] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupConsent, setSignupConsent] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [requestNote, setRequestNote] = useState<string | null>(null);

  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const enter = useCallback(async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const me = await automationLogin(c);
      try {
        localStorage.setItem(CODE_KEY, c);
      } catch {}
      setCode(c);
      setName(me.name);
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
          void enter(r.code);
        } else if (r.status === "rejected") {
          writeRequestId("");
          setRequestId("");
          setRequestNote("승인되지 않았어요. 선생님께 문의해 주세요.");
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
  }, [requestId, name, enter]);

  async function requestAccess() {
    const n = signupName.trim();
    if (!n || !signupBirth || !signupPhone.trim() || !signupConsent) return;
    setBusy(true);
    setError(null);
    try {
      const r = await automationRequestAccess({ name: n, birth: signupBirth, phone: signupPhone.trim(), consent: signupConsent });
      writeRequestId(r.id);
      setRequestId(r.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!name) return;
    listJournalEntries(code)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : "일지를 불러오지 못했습니다."));
  }, [name, code]);

  async function handleCreate() {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await createJournalEntry(code, t, content.trim());
      setEntries((prev) => [entry, ...(prev ?? [])]);
      setTitle("");
      setContent("");
      setComposing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "작성하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    try {
      localStorage.removeItem(CODE_KEY);
    } catch {}
    setName(null);
    setCode("");
    setEntries(null);
  }

  return (
    <main className="min-h-dvh bg-[#f2f4f6] pb-20 text-slate-900">
      <header className="sticky top-0 z-10 bg-[#f2f4f6]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4">
          <Link href="/automation" aria-label="자동화 작업으로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex items-center gap-1.5 text-[17px] font-bold tracking-tight">
            <BookOpen className="h-5 w-5 text-indigo-600" />
            내 작업 일지
          </h1>
          {name && (
            <button onClick={logout} className="ml-auto flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-slate-500 transition hover:bg-white">
              <LogOut className="h-4 w-4" />
              나가기
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        {!name && requestId ? (
          <section className={`${CARD} space-y-4 text-center`}>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-600" />
            <p className="text-[15px] font-semibold">승인을 기다리고 있어요</p>
            <p className="text-[13px] text-slate-500">선생님이 승인하면 자동으로 들어갑니다.</p>
          </section>
        ) : !name && mode === "signup" ? (
          <section className={`${CARD} space-y-4`}>
            <p className="text-[15px] font-semibold">일지는 본인과 선생님만 볼 수 있어요. 수강생 승인이 필요합니다.</p>
            <input className={INPUT} value={signupName} onChange={(e) => setSignupName(e.target.value)} placeholder="이름" maxLength={20} autoComplete="name" />
            <input type="date" className={INPUT} value={signupBirth} onChange={(e) => setSignupBirth(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            <input className={INPUT} value={signupPhone} onChange={(e) => setSignupPhone(e.target.value)} placeholder="전화번호 (예: 010-1234-5678)" type="tel" inputMode="tel" autoComplete="tel" />
            <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-600">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-indigo-600" checked={signupConsent} onChange={(e) => setSignupConsent(e.target.checked)} />
              <span className="break-keep">이름·생년월일·전화번호를 수강생 확인과 승인 목적으로 수집하는 데 동의합니다.</span>
            </label>
            <button disabled={busy || !signupName.trim() || !signupBirth || !signupPhone.trim() || !signupConsent} onClick={requestAccess} className={PRIMARY}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "승인 요청 보내기"}
            </button>
            <button onClick={() => setMode("code")} className="w-full py-2 text-[14px] font-medium text-slate-500 underline underline-offset-4">
              이미 받은 코드가 있어요
            </button>
            {requestNote && <p className="text-[14px] font-semibold text-rose-700">{requestNote}</p>}
          </section>
        ) : !name ? (
          <section className={`${CARD} space-y-4`}>
            <p className="text-[15px] text-slate-600">수강생 코드를 입력하면 바로 들어갈 수 있어요.</p>
            <input className={INPUT} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="수강생 코드" autoComplete="off" onKeyDown={(e) => e.key === "Enter" && codeInput && enter(codeInput.trim())} />
            <button disabled={busy || !codeInput.trim()} onClick={() => enter(codeInput.trim())} className={PRIMARY}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "입장하기"}
            </button>
            <button onClick={() => setMode("signup")} className="w-full py-2 text-[14px] font-medium text-slate-500 underline underline-offset-4">
              코드가 없어요 (승인 요청하기)
            </button>
          </section>
        ) : (
          <>
            {composing ? (
              <section className={`${CARD} space-y-3`}>
                <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (예: 10/7 현장 — 상부장 필름)" maxLength={60} />
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  maxLength={4000}
                  placeholder="오늘 한 작업, 배운 점, 메모를 적어보세요"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] leading-relaxed text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20"
                />
                <div className="flex gap-2">
                  <button onClick={() => setComposing(false)} className="h-12 flex-1 rounded-xl bg-slate-100 text-[15px] font-semibold text-slate-700">
                    취소
                  </button>
                  <button disabled={busy || !title.trim()} onClick={handleCreate} className={`${PRIMARY} flex-[2]`}>
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "작성하기"}
                  </button>
                </div>
              </section>
            ) : (
              <button onClick={() => setComposing(true)} className={PRIMARY}>
                <Plus className="h-5 w-5" />
                새 일지 작성
              </button>
            )}

            {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-[14px] font-semibold text-rose-700">{error}</p>}

            <div className="space-y-3">
              {entries === null ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  불러오는 중...
                </div>
              ) : entries.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-slate-400">아직 쓴 일지가 없어요. 위에서 첫 일지를 남겨보세요.</p>
              ) : (
                entries.map((e) => (
                  <Link key={e.id} href={`/automation/journal/entry?id=${e.id}`} className={`${CARD} block space-y-1.5`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[15px] font-bold">{e.title}</p>
                      <span className="shrink-0 text-[12px] text-slate-400">{formatDate(e.created)}</span>
                    </div>
                    {e.content && <p className="line-clamp-2 text-[13px] text-slate-500">{e.content}</p>}
                    {e.photos.length > 0 && (
                      <p className="flex items-center gap-1 text-[12px] text-slate-400">
                        <ImageIcon className="h-3.5 w-3.5" />
                        사진 {e.photos.length}장
                      </p>
                    )}
                  </Link>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
