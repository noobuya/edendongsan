"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, FileText, Loader2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import {
  buildNaverSteps,
  copyNaverStep,
  fetchClipboardPng,
  type NaverExportPost,
} from "@/lib/naverBlogExport";

/** 글 → 사진1 → 사진2 … 를 하나씩 클립보드에 넣고, 사장님이 네이버 글쓰기 화면에서
 *  Ctrl+V 하는 흐름. 사진은 "파일"로 들어가서 네이버가 확실히 업로드한다
 *  (lib/naverBlogExport.ts의 "한 단계씩 복사" 주석 참고). */
export default function NaverStepCopyPanel({ post }: { post: NaverExportPost }) {
  const steps = useMemo(() => buildNaverSteps(post), [post]);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [copying, setCopying] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 패널을 여는 순간 사진을 전부 PNG로 미리 만들어 둔다 — 버튼을 누른 뒤에 만들기
  // 시작하면 그사이 브라우저의 "방금 누름" 허용이 풀려 복사가 거부될 수 있다.
  const pngs = useRef(new Map<string, Promise<Blob>>());

  useEffect(() => {
    for (const step of steps) {
      if (step.kind === "photo" && !pngs.current.has(step.url)) {
        const p = fetchClipboardPng(step.url);
        p.catch(() => undefined); // 실패는 그 단계를 누를 때 보여준다
        pngs.current.set(step.url, p);
      }
    }
  }, [steps]);

  const next = steps.findIndex((_, i) => !done.has(i));

  async function handleCopy(index: number) {
    const step = steps[index];
    setCopying(index);
    setError(null);
    try {
      await copyNaverStep(step, step.kind === "photo" ? pngs.current.get(step.url) : undefined);
      setDone((prev) => new Set(prev).add(index));
    } catch (err) {
      setError(err instanceof Error ? err.message : "복사하지 못했습니다.");
    } finally {
      setCopying(null);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs leading-relaxed text-slate-600">
        <b>사진까지 확실하게 넣는 방법</b> — 위에서부터 차례로 <b>[복사]</b>를 누르고, 네이버 블로그 글쓰기
        화면에서 <b>Ctrl+V</b>. 그다음 줄의 [복사] → Ctrl+V … 를 반복하세요. 사진은 파일로 붙여넣어져 바로
        올라갑니다.
      </p>
      <ol className="space-y-1.5">
        {steps.map((step, i) => {
          const isDone = done.has(i);
          const isNext = i === next;
          return (
            <li
              key={i}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                isNext ? "bg-emerald-50 ring-1 ring-emerald-200" : ""
              }`}
            >
              <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-400">{i + 1}</span>
              {step.kind === "photo" ? (
                <AssetImage src={step.url} alt={step.label} className="h-10 w-10 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100">
                  <FileText className="h-4 w-4 text-slate-500" />
                </span>
              )}
              <span className={`flex-1 text-[13px] ${isDone ? "text-slate-400" : "text-slate-700"}`}>{step.label}</span>
              <button
                type="button"
                onClick={() => handleCopy(i)}
                disabled={copying !== null}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95 disabled:opacity-60 ${
                  isDone
                    ? "bg-slate-100 text-slate-500"
                    : isNext
                      ? "bg-[#03c75a] text-white"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                {copying === i ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isDone ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <ClipboardCopy className="h-3 w-3" />
                )}
                {isDone ? "복사함" : "복사"}
              </button>
            </li>
          );
        })}
      </ol>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {next === -1 && <p className="text-xs text-emerald-700">모두 복사했어요. 네이버에서 발행만 하시면 됩니다.</p>}
    </div>
  );
}
