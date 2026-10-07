"use client";

import { useEffect, useState } from "react";
import { Loader2, Users, X } from "lucide-react";
import { automationLogin, createSharedEstimate } from "@/lib/api";
import type { EstimateBreakdown } from "@/types";

// /automation 로그인과 같은 키 — 이미 로그인돼 있으면 이름을 자동으로 채운다.
const CODE_KEY = "eden-automation-code";

interface Props {
  estimate: EstimateBreakdown;
  open: boolean;
  onClose: () => void;
}

/** 완성된 견적에서 고객 이름·사진을 뺀 품목·단가·총액만 커뮤니티에 올리는 폼. */
export default function ShareEstimateDialog({ estimate, open, onClose }: Props) {
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setError(null);
    try {
      const code = localStorage.getItem(CODE_KEY);
      if (code) automationLogin(code).then((me) => setAuthor((prev) => prev || me.name)).catch(() => {});
    } catch {}
  }, [open]);

  if (!open) return null;

  async function handleShare() {
    const name = author.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await createSharedEstimate({
        author: name,
        item_names: estimate.line_items.map((li) => li.item_name),
        line_items: estimate.line_items,
        total_cost: estimate.total_cost,
        note: note.trim(),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "공유에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[17px] font-bold text-slate-900">
            <Users className="h-5 w-5 text-indigo-600" />
            견적 공유하기
          </h2>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4 py-4 text-center">
            <p className="text-[15px] font-semibold text-slate-800">커뮤니티에 올렸어요. 감사합니다!</p>
            <button
              type="button"
              onClick={onClose}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white"
            >
              닫기
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-slate-500">
              품목·단가·총액만 올라갑니다. 고객 이름이나 현장 사진은 올라가지 않아요.
            </p>
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold text-slate-700">이름</span>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="예: 김철수"
                maxLength={20}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold text-slate-700">메모 (선택)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="왜 이렇게 책정했는지, 참고할 점 등"
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20"
              />
            </label>
            {error && <p className="text-[13px] font-semibold text-rose-600">{error}</p>}
            <button
              type="button"
              disabled={busy || !author.trim()}
              onClick={handleShare}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "커뮤니티에 올리기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
