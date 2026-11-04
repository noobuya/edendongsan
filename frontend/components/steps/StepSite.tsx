"use client";

import { useState } from "react";
import { adminListStudents } from "@/lib/api";

interface Props {
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  /** 이 기기가 사장님 기기인지. 아니면 일러스트 입력을 보여주지 않는다. */
  isOwner: boolean;
  /** 확인된 관리자 토큰을 이 기기에 저장한다. */
  onSaveOwnerToken: (token: string) => void;
  onClearOwnerToken: () => void;
}

// [왜 글씨에 옅은 흰 그림자를 넣는가 — 2026-11-05 "글자는 더욱더 선명하게"]
// 이 카드(.glass-panel)는 사장님이 고른 대표 사진이 비치도록 불투명도를 크게
// 낮췄다(globals.css 참고). 사진이 밝을 때 진한 글씨 대비가 살짝 떨어질 수
// 있어, 글씨 바로 뒤에 아주 옅은 흰 번짐을 깔아 사진이 어떤 색이든 글씨
// 테두리가 또렷하게 떠 보이게 한다 — 그림자라기보다 "글씨 자리만 살짝 더
// 밝히는" 효과라 눈에 띄는 윤곽선처럼 보이지 않는다.
const crisp = "[text-shadow:0_1px_3px_rgba(255,255,255,0.7)]";

const FIELD =
  `w-full min-w-0 border-0 border-b-[1.5px] border-black/20 bg-transparent px-0 pb-3 pt-2 text-[18px] font-bold text-black outline-none transition-colors placeholder:font-normal placeholder:text-slate-600/70 focus:border-indigo-600 focus:ring-0 ${crisp}`;

/** 1단계 — 현장 등록. 사진은 배경 무대에서 찍으므로, 이 패널은 사람이 적는 정보만
 *  받는다. 큰 제목 없이 고객명 한 줄만 받는 작은 카드다 — 바로 위 무대에 이미
 *  상호와 "시공 공간 촬영하기" 안내가 떠 있어, 여기서 또 "현장 등록"이라고
 *  반복할 필요가 없다(2026-11-05, 카드를 최대한 작게 줄이면서 함께 정리). */
export default function StepSite({
  customerName,
  onCustomerNameChange,
  isOwner,
  onSaveOwnerToken,
  onClearOwnerToken,
}: Props) {
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // 입력한 토큰을 서버에 한 번 물어본다. 관리자 목록 조회가 통과하면 올바른 토큰이다.
  async function handleSaveToken() {
    const token = tokenInput.trim();
    if (!token) return;
    setTokenBusy(true);
    setTokenError(null);
    try {
      await adminListStudents(token);
      onSaveOwnerToken(token);
      setTokenInput("");
      setTokenOpen(false);
    } catch {
      setTokenError("토큰이 맞지 않거나 서버에 연결할 수 없어요.");
    } finally {
      setTokenBusy(false);
    }
  }

  return (
    <div className="space-y-5 animate-[step-in_0.35s_ease-out]">
      <label className="block">
        <span className={`block text-[11px] font-bold uppercase tracking-wider text-black ${crisp}`}>
          고객명 · 선택
        </span>
        <input
          type="text"
          value={customerName}
          onChange={(e) => onCustomerNameChange(e.target.value)}
          placeholder="홍길동 고객님"
          className={FIELD}
        />
      </label>

      {/* 사장님 기기 설정. 토큰을 아는 사람만 일러스트를 연다. 작은 카드 안에서
          너무 눈에 띄면 안 되지만, 더 또렷해야 한다는 요청에 맞춰 밑줄 대신
          옅은 알약 모양으로 바꿔 터치 영역도 함께 넓혔다. */}
      <div className={`text-[12.5px] font-semibold text-slate-600 ${crisp}`}>
        {isOwner ? (
          <button type="button" onClick={onClearOwnerToken} className="rounded-full px-1 py-1 underline underline-offset-4">
            이 기기 사장님 설정 해제
          </button>
        ) : tokenOpen ? (
          <div className="space-y-3">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="관리자 토큰"
              autoComplete="off"
              className={FIELD}
            />
            {tokenError && <p className="text-[12px] font-semibold text-rose-600">{tokenError}</p>}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={handleSaveToken}
                disabled={tokenBusy || !tokenInput.trim()}
                className="underline underline-offset-4 disabled:opacity-40"
              >
                {tokenBusy ? "확인 중…" : "이 기기에 저장"}
              </button>
              <button type="button" onClick={() => setTokenOpen(false)} className="underline underline-offset-4">
                닫기
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setTokenOpen(true)} className="rounded-full px-1 py-1 underline underline-offset-4">
            사장님 기기 설정
          </button>
        )}
      </div>
    </div>
  );
}
