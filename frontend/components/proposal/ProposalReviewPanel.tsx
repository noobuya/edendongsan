"use client";

import { useState } from "react";
import { Loader2, Send, Sparkles, Sun, SunDim } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import { sendProposalFeedback } from "@/lib/api";
import type { Proposal, ProposalFeedbackAction, ProposalFeedbackTarget } from "@/types";

interface Props {
  proposal: Proposal;
  ownerToken: string;
  onChange: (p: Proposal) => void;
  onPublish: () => void;
  publishing: boolean;
}

/** 생성된 제안서를 확인하고, 마음에 안 드는 부분만 골라 다시 만드는 대화형 컨펌 UI.
 *  "전체 재생성"이 아니라 선택한 조각(이미지 또는 카피)만 다시 만든다. */
export default function ProposalReviewPanel({ proposal, ownerToken, onChange, onPublish, publishing }: Props) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customNote, setCustomNote] = useState("");
  const [showCustom, setShowCustom] = useState<ProposalFeedbackTarget | null>(null);

  async function act(target: ProposalFeedbackTarget, action: ProposalFeedbackAction, note = "") {
    setError(null);
    setBusyAction(`${target}:${action}`);
    try {
      const updated = await sendProposalFeedback(proposal.id, target, action, ownerToken, note);
      onChange(updated);
      setShowCustom(null);
      setCustomNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "다시 만들지 못했습니다.");
    } finally {
      setBusyAction(null);
    }
  }

  const isBusy = (key: string) => busyAction === key;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1.5 px-1 text-[12px] font-semibold text-slate-500">와이드컷</p>
          <AssetImage src={proposal.wide_image_url} alt="와이드컷" className="aspect-square w-full rounded-xl object-cover" />
        </div>
        <div>
          <p className="mb-1.5 px-1 text-[12px] font-semibold text-slate-500">디테일컷</p>
          <AssetImage src={proposal.detail_image_url} alt="디테일컷" className="aspect-square w-full rounded-xl object-cover" />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => act("detail_image", "brighter")}
              disabled={!!busyAction}
              className="flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-slate-100 text-[13px] font-semibold text-slate-700 disabled:opacity-40"
            >
              {isBusy("detail_image:brighter") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sun className="h-3.5 w-3.5" />}
              더 밝게
            </button>
            <button
              type="button"
              onClick={() => act("detail_image", "darker")}
              disabled={!!busyAction}
              className="flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-slate-100 text-[13px] font-semibold text-slate-700 disabled:opacity-40"
            >
              {isBusy("detail_image:darker") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SunDim className="h-3.5 w-3.5" />}
              더 어둡게
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
        <p className="text-[15px] font-bold text-slate-900">{proposal.headline}</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{proposal.body}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => act("copy", "shorter")}
            disabled={!!busyAction}
            className="flex h-9 items-center gap-1 rounded-full bg-indigo-50 px-3 text-[12.5px] font-semibold text-indigo-700 disabled:opacity-40"
          >
            {isBusy("copy:shorter") && <Loader2 className="h-3 w-3 animate-spin" />}
            텍스트 더 짧게
          </button>
          <button
            type="button"
            onClick={() => act("copy", "longer")}
            disabled={!!busyAction}
            className="flex h-9 items-center gap-1 rounded-full bg-indigo-50 px-3 text-[12.5px] font-semibold text-indigo-700 disabled:opacity-40"
          >
            {isBusy("copy:longer") && <Loader2 className="h-3 w-3 animate-spin" />}
            텍스트 더 길게
          </button>
          <button
            type="button"
            onClick={() => setShowCustom(showCustom === "copy" ? null : "copy")}
            className="flex h-9 items-center gap-1 rounded-full bg-slate-100 px-3 text-[12.5px] font-semibold text-slate-600"
          >
            <Sparkles className="h-3 w-3" />
            직접 피드백
          </button>
        </div>

        {showCustom === "copy" && (
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="예: 가격 비교 문구를 맨 앞으로 옮겨줘"
              className="h-11 flex-1 rounded-xl border border-slate-200 px-3 text-[13.5px] outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => act("copy", "custom", customNote)}
              disabled={!customNote.trim() || !!busyAction}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-40"
              aria-label="피드백 보내기"
            >
              {isBusy("copy:custom") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>

      {error && <p className="px-1 text-[13px] font-semibold text-rose-700">{error}</p>}

      <button
        type="button"
        onClick={onPublish}
        disabled={publishing || !!busyAction}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-[16px] font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
      >
        {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
        확정 및 공유 링크 발행
      </button>
    </div>
  );
}
