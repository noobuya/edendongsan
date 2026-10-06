"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
import { adminListStudents } from "@/lib/api";

interface Props {
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  illustText: string;
  onIllustTextChange: (value: string) => void;
  illustDescription: string;
  onIllustDescriptionChange: (value: string) => void;
  /** 이 기기가 사장님 기기인지. 아니면 일러스트 입력을 보여주지 않는다. */
  isOwner: boolean;
  /** 확인된 관리자 토큰을 이 기기에 저장한다. */
  onSaveOwnerToken: (token: string) => void;
  onClearOwnerToken: () => void;
}

const FIELD =
  "w-full min-w-0 border-0 border-b border-slate-900/10 bg-transparent px-0 pb-3 pt-2 text-[17px] font-light text-slate-900 outline-none transition-colors placeholder:font-light placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0";

/** 1단계 — 현장 등록. 사진은 배경 무대에서 찍으므로, 이 패널은 사람이 적는 정보만 받는다. */
export default function StepSite({
  customerName,
  onCustomerNameChange,
  illustText,
  onIllustTextChange,
  illustDescription,
  onIllustDescriptionChange,
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
    <div className="space-y-9 animate-[step-in_0.35s_ease-out]">
      <div>
        <h2 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">현장 등록</h2>
        <p className="mt-2 text-[14px] font-light text-slate-500">사진을 담고 고객 정보를 적어주세요</p>
      </div>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">고객명</span>
        <input
          type="text"
          value={customerName}
          onChange={(e) => onCustomerNameChange(e.target.value)}
          placeholder="홍길동 고객님"
          className={FIELD}
        />
      </label>

      {/* 사장님 기기에서만 보인다. 학생 기기에는 문구·그림 입력 자체가 나오지 않는다. */}
      {isOwner && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-indigo-500" />
            <span className="text-[13px] font-semibold tracking-tight text-slate-900">넣을 문구·그림</span>
            <span className="text-[11px] font-light text-slate-400">일러스트 유리시공</span>
          </div>

          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">문구</span>
            <input
              type="text"
              value={illustText}
              onChange={(e) => onIllustTextChange(e.target.value)}
              placeholder="DAEHAN INTERIOR FILM"
              className={FIELD}
            />
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">그림 설명</span>
            <textarea
              value={illustDescription}
              onChange={(e) => onIllustDescriptionChange(e.target.value)}
              rows={3}
              placeholder="얇은 선으로 그린 올리브 나뭇가지를 문구 왼쪽에"
              className={`${FIELD} resize-none leading-relaxed`}
            />
          </label>
        </div>
      )}

      {/* 사장님 기기 설정. 토큰을 아는 사람만 일러스트를 연다. */}
      <div className="pt-2 text-[12px] font-light text-slate-400">
        {isOwner ? (
          <button type="button" onClick={onClearOwnerToken} className="underline underline-offset-4">
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
            {tokenError && <p className="text-[12px] text-rose-500">{tokenError}</p>}
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
          <button type="button" onClick={() => setTokenOpen(true)} className="underline underline-offset-4">
            사장님 기기 설정
          </button>
        )}
      </div>
    </div>
  );
}
