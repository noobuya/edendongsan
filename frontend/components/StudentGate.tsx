"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  adminListStudents,
  automationLogin,
  automationRequestAccess,
  automationRequestStatus,
} from "@/lib/api";
import { readRequestId, readStudentCode, saveStudentCode, writeRequestId } from "@/lib/studentAccess";
import { saveOwnerToken } from "@/lib/ownerToken";

interface Props {
  /** 수강생 승인이 확인되면 호출된다. 이 화면은 바로 사라진다. */
  onEnter: (code: string) => void;
  /** 사장님 토큰이 확인되면 호출된다. */
  onOwner: (token: string) => void;
}

const input =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20";

/** 견적 화면 입구. 수강생 승인 코드나 사장님 토큰이 없으면 이 화면에서 막는다.
 *  승인 흐름은 /automation 화면과 같은 API를 쓴다. */
export default function StudentGate({ onEnter, onOwner }: Props) {
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<"signup" | "code">("signup");
  const [codeInput, setCodeInput] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupBirth, setSignupBirth] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupConsent, setSignupConsent] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [requestNote, setRequestNote] = useState<string | null>(null);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerInput, setOwnerInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        await automationLogin(code);
        saveStudentCode(code);
        writeRequestId("");
        onEnter(code);
      } catch (err) {
        setError(err instanceof Error ? err.message : "입장하지 못했습니다.");
        setChecking(false);
      } finally {
        setBusy(false);
      }
    },
    [onEnter]
  );

  useEffect(() => {
    const saved = readStudentCode();
    if (saved) {
      void enter(saved);
      return;
    }
    const rid = readRequestId();
    if (rid) setRequestId(rid);
    setChecking(false);
  }, [enter]);

  // 승인 대기 중이면 8초마다 상태를 확인한다. 승인되면 코드가 저장되고 바로 들어간다.
  useEffect(() => {
    if (!requestId) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await automationRequestStatus(requestId);
        if (stop) return;
        if (r.status === "approved" && r.code) {
          setRequestId("");
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
  }, [requestId, enter]);

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

  async function enterAsOwner() {
    const token = ownerInput.trim();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await adminListStudents(token);
      saveOwnerToken(token);
      onOwner(token);
    } catch {
      setError("토큰이 맞지 않거나 서버에 연결할 수 없어요.");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f2f4f6]">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f2f4f6] px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-bold">수강생 승인이 필요해요</h1>
          <p className="text-[14px] leading-relaxed text-slate-600 break-keep">
            이 견적 앱은 수강생 승인을 받은 뒤에 쓸 수 있어요. 이름으로 승인을 요청하거나, 받은 코드를 입력해 주세요.
          </p>
        </div>

        {requestId ? (
          <section className="space-y-3">
            <p className="text-[16px] font-bold text-slate-900">승인을 기다리고 있어요</p>
            <p className="text-[14px] leading-relaxed text-slate-600 break-keep">
              선생님이 승인하면 자동으로 들어가집니다. 이 화면을 닫지 않아도 돼요.
            </p>
            <button
              onClick={cancelRequest}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-slate-100 text-[15px] font-semibold text-slate-700"
            >
              요청 취소
            </button>
          </section>
        ) : mode === "signup" ? (
          <section className="space-y-3">
            <input
              className={input}
              value={signupName}
              onChange={(e) => setSignupName(e.target.value)}
              placeholder="이름"
              maxLength={20}
              autoComplete="name"
            />
            <div>
              <p className="mb-1 text-[13px] text-slate-500">생년월일</p>
              <input
                type="date"
                className={input}
                value={signupBirth}
                onChange={(e) => setSignupBirth(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <input
              className={input}
              value={signupPhone}
              onChange={(e) => setSignupPhone(e.target.value)}
              placeholder="전화번호 (예: 010-1234-5678)"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-600">
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
              className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "승인 요청 보내기"}
            </button>
            <button onClick={() => setMode("code")} className="w-full py-2 text-[14px] text-slate-500 underline">
              이미 받은 코드가 있어요
            </button>
          </section>
        ) : (
          <section className="space-y-3">
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
              className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "입장하기"}
            </button>
            <button onClick={() => setMode("signup")} className="w-full py-2 text-[14px] text-slate-500 underline">
              코드가 없어요 (승인 요청하기)
            </button>
          </section>
        )}

        {requestNote && <p className="text-[14px] font-semibold text-rose-700">{requestNote}</p>}
        {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}

        <div className="border-t border-slate-100 pt-4">
          {ownerOpen ? (
            <div className="space-y-3">
              <input
                type="password"
                className={input}
                value={ownerInput}
                onChange={(e) => setOwnerInput(e.target.value)}
                placeholder="관리자 토큰"
                autoComplete="off"
              />
              <button
                disabled={busy || !ownerInput.trim()}
                onClick={enterAsOwner}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-slate-100 text-[14px] font-semibold text-slate-700 disabled:opacity-40"
              >
                사장님 기기로 저장
              </button>
            </div>
          ) : (
            <button onClick={() => setOwnerOpen(true)} className="w-full py-2 text-[13px] text-slate-400 underline">
              사장님 기기입니다
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
