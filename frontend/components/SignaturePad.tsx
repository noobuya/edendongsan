"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { Check, Eraser, Loader2 } from "lucide-react";

interface Props {
  /** 서명을 서버에 보내 확정한다. 실패하면 에러를 던져서 호출한 쪽이 처리한다. */
  onSign: (dataUrl: string) => Promise<void>;
}

/** 현장에서 고객이 손가락/스타일러스로 직접 그리는 서명판.
 *
 *  signature_pad(캔버스 기반, 의존성 없음)를 그대로 쓴다 — 서명 입력은 세계
 *  어느 현장 서비스 앱(Jobber·Housecall Pro 등)에도 있는 표준 UX라, 손으로
 *  새로 구현하기보다 검증된 라이브러리를 쓰는 쪽이 느낌(필압에 따른 선 굵기 등)도
 *  훨씬 자연스럽다. */
export default function SignaturePad({ onSign }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [hasStroke, setHasStroke] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 캔버스를 실제 표시 크기 × devicePixelRatio로 맞춰야 고해상도 화면에서도
    // 선이 흐려 보이지 않는다(signature_pad 공식 권장 방식).
    function resize() {
      if (!canvas) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      padRef.current?.clear();
    }

    const pad = new SignaturePadLib(canvas, { backgroundColor: "rgba(255,255,255,1)" });
    pad.addEventListener("endStroke", () => setHasStroke(!pad.isEmpty()));
    padRef.current = pad;
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      pad.off();
    };
  }, []);

  function handleClear() {
    padRef.current?.clear();
    setHasStroke(false);
    setError(null);
  }

  async function handleConfirm() {
    const pad = padRef.current;
    if (!pad || pad.isEmpty() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSign(pad.toDataURL("image/png"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "서명 저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="relative overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-white">
        <canvas ref={canvasRef} className="h-40 w-full touch-none" />
        {!hasStroke && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-slate-300">
            여기에 서명해 주세요
          </p>
        )}
      </div>

      {error && <p className="text-[12px] font-medium text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClear}
          disabled={submitting}
          className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-slate-100 text-[14px] font-semibold text-slate-600 disabled:opacity-50"
        >
          <Eraser className="h-4 w-4" />
          다시 쓰기
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!hasStroke || submitting}
          className="flex h-12 flex-[2] items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 text-[14px] font-bold text-white transition-transform active:scale-[0.98] disabled:bg-slate-900/[0.1] disabled:text-slate-400"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {submitting ? "저장 중..." : "서명 완료"}
        </button>
      </div>
    </div>
  );
}
