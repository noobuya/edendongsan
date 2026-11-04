"use client";

import { useState } from "react";
import { adminListStudents } from "@/lib/api";
import { saveOwnerToken } from "@/lib/ownerToken";

const FIELD =
  "w-full min-w-0 border-0 border-b border-slate-900/10 bg-transparent px-0 pb-3 pt-2 text-[15px] font-medium text-slate-900 outline-none transition-colors placeholder:font-normal placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0";

/** "사장님 기기 설정" — 설치된 앱(WebView)과 일반 브라우저는 저장소가 서로 완전히
 *  분리돼 있어(lib/ownerToken.ts 주석 참고), 브라우저에서 한 번 설정했다고 앱에도
 *  저장되지 않는다. 그래서 앱에서 보면 사장님 전용 버튼(시공 영상 다시 만들기·글
 *  다시 쓰기 등)이 "왜 없지" 싶게 조용히 사라져 보인다 — 반대로 앱에서 먼저
 *  설정했어도 브라우저에서는 다시 설정해야 한다.
 *
 *  2026-11-05 "웹에는 있는데 앱에는 없다" 제보: 기기(=WebView 인스턴스)마다
 *  따로 설정해야 하는 게 원인이었다. 이 컴포넌트는 그 설정 창을 어디서든
 *  바로 열 수 있게 하는 공통 조각이다 — 전엔 홈 화면(StepSite, 1단계)에만
 *  있어서, 블로그 글처럼 다른 화면에 있다가 "여기도 사장님 전용 기능이 있었는데
 *  없다"고 느끼면 홈으로 돌아가 찾아야 했다. */
export default function OwnerUnlock({
  onUnlocked,
  label = "사장님 기기 설정",
  className = "",
}: {
  /** 토큰이 확인되고 이 기기에 저장된 뒤 호출된다 — 호출한 화면이 자기 state를
   *  갱신해 새로고침 없이 바로 사장님 전용 UI를 보여줄 수 있게 토큰을 넘긴다. */
  onUnlocked: (token: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const token = tokenInput.trim();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      // 입력한 토큰을 서버에 한 번 물어본다 — 관리자 목록 조회가 통과하면 올바른 토큰이다.
      await adminListStudents(token);
      saveOwnerToken(token);
      setTokenInput("");
      setOpen(false);
      onUnlocked(token);
    } catch {
      setError("토큰이 맞지 않거나 서버에 연결할 수 없어요.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-full px-1 py-1 text-[12.5px] font-semibold text-slate-500 underline underline-offset-4 ${className}`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <input
        type="password"
        value={tokenInput}
        onChange={(e) => setTokenInput(e.target.value)}
        placeholder="관리자 토큰"
        autoComplete="off"
        className={FIELD}
      />
      {error && <p className="text-[12px] font-semibold text-rose-600">{error}</p>}
      <div className="flex gap-4 text-[12.5px] font-semibold text-slate-500">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !tokenInput.trim()}
          className="underline underline-offset-4 disabled:opacity-40"
        >
          {busy ? "확인 중…" : "이 기기에 저장"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="underline underline-offset-4">
          닫기
        </button>
      </div>
    </div>
  );
}
