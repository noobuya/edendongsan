"use client";

import { Lightbulb, X } from "lucide-react";

/** 사진 촬영 안내 문구. 정확한 견적을 위해 문 손잡이와 테두리가 보여야 AI가 문짝 경계를 잡는다. */
export const PHOTO_GUIDE_TIP = "정확한 견적을 위해 문 손잡이와 전체 테두리가 잘 보이게 정면에서 찍어주세요";

/** 촬영 예시 그림. 실제 사진 없이도 읽히도록 선으로 그린 정면 도해다.
 *  문틀 테두리·손잡이·경첩·천장 몰딩·걸레받이 위치를 표시한다. */
export function PhotoGuideExample({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 240"
      role="img"
      aria-label="정면 촬영 예시: 문 테두리, 손잡이, 경첩, 천장 몰딩, 걸레받이가 모두 보이는 구도"
      className={className}
    >
      {/* 벽과 천장, 걸레받이, 바닥 */}
      <rect x="0" y="0" width="320" height="240" fill="#f1f5f9" />
      <rect x="0" y="0" width="320" height="28" fill="#e2e8f0" />
      <rect x="0" y="28" width="320" height="6" fill="#cbd5e1" />
      <rect x="0" y="214" width="320" height="10" fill="#cbd5e1" />
      <rect x="0" y="224" width="320" height="16" fill="#e2e8f0" />

      {/* 문틀 테두리(네 변 모두 보여야 한다) */}
      <rect x="92" y="44" width="136" height="170" fill="none" stroke="#475569" strokeWidth="10" />
      {/* 문짝 */}
      <rect x="102" y="54" width="116" height="160" fill="#ffffff" stroke="#334155" strokeWidth="2" />

      {/* 경첩 3개 (문짝 왼쪽 가장자리) */}
      <rect x="99" y="72" width="8" height="16" rx="2" fill="#94a3b8" />
      <rect x="99" y="128" width="8" height="16" rx="2" fill="#94a3b8" />
      <rect x="99" y="184" width="8" height="16" rx="2" fill="#94a3b8" />

      {/* 손잡이 */}
      <rect x="196" y="128" width="6" height="34" rx="3" fill="#334155" />

      {/* 표시 문구 */}
      <g fontFamily="sans-serif" fontSize="11" fill="#0f172a" fontWeight="700">
        <text x="8" y="19" fill="#475569" fontSize="10" fontWeight="600">천장 몰딩</text>
        <text x="236" y="60">문틀 테두리</text>
        <text x="236" y="150">손잡이</text>
        <line x1="204" y1="145" x2="232" y2="145" stroke="#0f172a" strokeWidth="1" />
        <text x="14" y="112">경첩</text>
        <line x1="34" y1="117" x2="98" y2="117" stroke="#0f172a" strokeWidth="1" />
        <text x="10" y="170">벽면</text>
        <text x="236" y="208" fontSize="10" fill="#475569">걸레받이</text>
      </g>
    </svg>
  );
}

/** 촬영 예시를 펼쳐 보여주는 시트. 카메라 화면 위에서도 열리도록 가장 위 층에 뜬다. */
export function PhotoGuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/60 p-3 animate-[fade-in_0.2s_ease-out] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-guide-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="photo-guide-title" className="text-[17px] font-extrabold text-slate-900">
            촬영 예시
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-transform active:scale-90"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <PhotoGuideExample className="mt-4 w-full rounded-2xl border border-slate-200" />

        <ul className="mt-4 space-y-2 text-[14px] leading-relaxed text-slate-700 break-keep">
          <li>· 문 손잡이와 경첩이 모두 보이도록 정면에서 찍어주세요.</li>
          <li>· 문틀 테두리가 네 변 모두 화면 안에 들어오게 조금 떨어져서 찍어주세요.</li>
          <li>· 벽은 천장 몰딩부터 걸레받이까지 한 장에 담아주세요.</li>
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 flex h-14 w-full items-center justify-center rounded-2xl bg-indigo-600 text-[15px] font-bold text-white transition-transform active:scale-[0.98]"
        >
          확인
        </button>
      </div>
    </div>
  );
}

/** 촬영 화면에 얹는 안내 줄. 예시 보기 버튼을 함께 둔다. */
export function PhotoGuideTip({
  onOpenExample,
  className = "",
}: {
  onOpenExample: () => void;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 rounded-2xl bg-black/45 px-4 py-2.5 text-left backdrop-blur-sm ${className}`}
    >
      <Lightbulb className="h-4 w-4 shrink-0 text-amber-300" strokeWidth={2} />
      <p className="flex-1 text-[13px] font-medium leading-snug text-white break-keep">{PHOTO_GUIDE_TIP}</p>
      <button
        type="button"
        onClick={onOpenExample}
        className="shrink-0 rounded-full bg-white/20 px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-white/30 active:scale-95"
      >
        예시 보기
      </button>
    </div>
  );
}
