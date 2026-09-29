"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 시트 아래에 고정으로 붙는 확인 버튼 영역 (선택). */
  footer?: React.ReactNode;
}

/** 화면 아래에서 올라오는 모달 시트. 아코디언처럼 화면이 아래로 늘어나지 않고
 *  현재 맥락 위에 겹쳐 뜨기 때문에, 항목을 여러 개 다뤄도 페이지가 길어지지 않는다. */
export default function BottomSheet({ open, title, description, onClose, children, footer }: Props) {
  // 시트가 떠 있는 동안 뒤 페이지가 같이 스크롤되면 내용이 어긋난다.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 animate-[fade-in_0.2s_ease-out] backdrop-blur-sm foldLandscape:items-center foldLandscape:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-white/60 bg-white/85 shadow-[0_-8px_40px_rgba(0,0,0,0.12)] backdrop-blur-2xl animate-[sheet-up_0.28s_cubic-bezier(0.32,0.72,0,1)] foldLandscape:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 아래로 쓸어내려 닫는 시트라는 신호 */}
        <div className="flex shrink-0 justify-center pt-3">
          <div className="h-1.5 w-11 rounded-full bg-slate-200" />
        </div>

        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-2 pt-4">
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold tracking-tight text-slate-900">{title}</h2>
            {description && <p className="mt-1.5 text-[13px] font-light leading-relaxed text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-transform active:scale-90"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">{children}</div>

        {footer && <div className="shrink-0 border-t border-white/50 bg-white/60 px-6 pb-safe pt-3 backdrop-blur-xl">{footer}</div>}
      </div>
    </div>
  );
}
