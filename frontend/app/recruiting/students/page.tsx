"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import LevelBadge from "@/components/recruiting/LevelBadge";
import {
  recruitingCreateScoutRequest,
  recruitingMySentScoutRequests,
  recruitingStudents,
  type ScoutRequest,
  type StudentDirectoryRow,
} from "@/lib/api";
import { useAndroidBack } from "@/lib/useAndroidBack";

const CODE_KEY = "eden-recruiting-code";
const CARD = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70";
const SCOUT_STATUS_LABEL: Record<ScoutRequest["status"], string> = {
  PENDING: "응답 대기",
  ACCEPTED: "수락됨",
  DECLINED: "거절됨",
};
const SCOUT_STATUS_TONE: Record<ScoutRequest["status"], string> = {
  PENDING: "bg-slate-100 text-slate-600",
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  DECLINED: "bg-rose-50 text-rose-700",
};

function readCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** 기공이 특정 수강생을 콕 집어 "내일 현장 도와주실 수 있나요?" 지명 호출을
 *  보내는 화면 — 레벨/뱃지로 신뢰도를 보고 고른다(EXPERT 전용, /api/recruiting/students
 *  자체가 403으로 막아 두 번째 방어선이 있다). */
export default function ScoutDirectoryPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [code] = useState(readCode);
  const [students, setStudents] = useState<StudentDirectoryRow[] | null>(null);
  const [sent, setSent] = useState<ScoutRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setError("먼저 /recruiting에서 입장해 주세요.");
      return;
    }
    recruitingStudents(code).then(setStudents).catch((err) => setError(err instanceof Error ? err.message : "불러오지 못했습니다."));
    void recruitingMySentScoutRequests(code).then(setSent).catch(() => {});
  }, [code]);

  function openModal(id: number) {
    setOpenFor(openFor === id ? null : id);
    setMessage("내일 현장 도와주실 수 있나요?");
  }

  async function send(targetUserId: number) {
    setBusy(true);
    setError(null);
    try {
      await recruitingCreateScoutRequest(code, { target_user_id: targetUserId, message: message.trim() });
      setSent(await recruitingMySentScoutRequests(code));
      setOpenFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "호출을 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function sentStatusFor(studentId: number): ScoutRequest | undefined {
    return sent.find((r) => r.target_user_id === studentId && r.status === "PENDING");
  }

  return (
    <main className="min-h-dvh bg-[#f2f4f6] pb-20 text-slate-900">
      <header className="sticky top-0 z-10 bg-[#f2f4f6]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4">
          <Link href="/recruiting" aria-label="뒤로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[17px] font-bold tracking-tight">수강생 지명 호출</h1>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-3 px-4 pt-4">
        {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}

        {!error && students === null && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </div>
        )}

        {students?.length === 0 && <p className="py-16 text-center text-sm text-slate-400">승인된 수강생이 없어요.</p>}

        {students?.map((s) => {
          const pending = sentStatusFor(s.id);
          return (
            <div key={s.id} className={CARD}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[15px] font-bold text-slate-900">{s.name}</p>
                  <LevelBadge level={s.level} badgeCount={s.badge_count} />
                </div>
                {pending && (
                  <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${SCOUT_STATUS_TONE[pending.status]}`}>
                    {SCOUT_STATUS_LABEL[pending.status]}
                  </span>
                )}
              </div>
              {s.badge_names.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.badge_names.map((n) => (
                    <span key={n} className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-600">
                      {n}
                    </span>
                  ))}
                </div>
              )}
              {!pending && (
                <button
                  onClick={() => openModal(s.id)}
                  className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 text-[13.5px] font-semibold text-white"
                >
                  <Send className="h-4 w-4" /> 지명 호출 보내기
                </button>
              )}
              {openFor === s.id && (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="h-20 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-500"
                    maxLength={500}
                  />
                  <button
                    disabled={busy || !message.trim()}
                    onClick={() => send(s.id)}
                    className="h-10 w-full rounded-xl bg-indigo-600 text-[13.5px] font-bold text-white disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "전송"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
