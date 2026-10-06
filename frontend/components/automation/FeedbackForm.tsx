"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { automationSendFeedback, type FeedbackKind } from "@/lib/api";

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "잘못 동작해요",
  improve: "이렇게 바꿔 주세요",
  other: "기타",
};

const input =
  "w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20";

/** 작업 한 건(jobId) 또는 일반 의견(jobId 없음)에 피드백을 보내는 폼. */
export default function FeedbackForm({
  code,
  jobId,
  onSent,
}: {
  code: string;
  jobId?: string;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await automationSendFeedback(code, { kind, message: text, job_id: jobId });
      setMessage("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(FEEDBACK_KIND_LABEL) as FeedbackKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`h-11 rounded-full px-4 text-[14px] font-semibold ${
              kind === k ? "bg-indigo-600 text-white" : "bg-white text-slate-600 shadow-sm"
            }`}
          >
            {FEEDBACK_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <textarea
        className={`${input} h-28 py-3`}
        value={message}
        maxLength={1000}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="어떤 점이 문제인지, 어떻게 바뀌면 좋을지 적어 주세요."
      />
      {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
      <button
        type="button"
        disabled={busy || !message.trim()}
        onClick={send}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "피드백 보내기"}
      </button>
    </div>
  );
}
