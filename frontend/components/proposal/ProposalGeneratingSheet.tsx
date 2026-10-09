"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

const STEPS = [
  { label: "기획 담당 AI 작업 중", sub: "사진 구도를 분석하고 있어요" },
  { label: "디테일 컷 생성 중", sub: "질감이 잘 보이는 부분을 잘라내고 있어요" },
  { label: "카피 작성 중", sub: "고객에게 보낼 문구를 쓰고 있어요" },
] as const;

// 백엔드는 한 번의 요청으로 끝까지 처리한다(별도 진행률 스트리밍 없음) — 그래서
// 실제 서버 진행 상황을 모르는 채로, 각 단계가 보통 걸리는 시간만큼만 흉내 내서
// 보여준다. 응답이 이 타이머보다 먼저 오면(onDone이 호출되면) 그 자리에서 멈추고,
// 더 오래 걸리면 마지막 단계에 머문 채로 실제 응답을 기다린다.
const STEP_DURATION_MS = 3500;

/** 생성 중 화면 — "기획 → 디테일컷 → 카피" 3단계를 순서대로 보여준다.
 *  open인 동안 떠 있고, 부모가 실제 API 응답을 받으면 그냥 이 컴포넌트를 치우면 된다. */
export default function ProposalGeneratingSheet({ open }: { open: boolean }) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
    }, STEP_DURATION_MS);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6">
      <div className="w-full max-w-sm rounded-[24px] bg-white p-6 shadow-xl">
        <p className="text-center text-[15px] font-bold text-slate-900">AI 제안서를 만들고 있어요</p>
        <ul className="mt-5 space-y-4">
          {STEPS.map((step, i) => {
            const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
            return (
              <li key={step.label} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    state === "done" ? "bg-emerald-500 text-white" : state === "active" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-300"
                  }`}
                >
                  {state === "done" ? <Check className="h-4 w-4" /> : state === "active" ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </span>
                <div>
                  <p className={`text-[14px] font-semibold ${state === "pending" ? "text-slate-300" : "text-slate-900"}`}>{step.label}</p>
                  {state === "active" && <p className="mt-0.5 text-[12.5px] text-slate-500">{step.sub}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
