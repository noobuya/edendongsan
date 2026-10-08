"use client";

import { Bot, Calculator, Newspaper, Ruler, Users } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ITEMS = [
  { icon: Calculator, label: "빠른 견적", desc: "사진 없이 평수·품목만으로 금액을 바로 확인" },
  { icon: Ruler, label: "스마트 재단 계산기", desc: "원단 폭에 맞춰 몇 장이 필요한지 계산" },
  { icon: Newspaper, label: "시공 후기", desc: "다른 현장의 시공 전후 사진 모아보기" },
  { icon: Users, label: "견적 공유", desc: "수강생들이 올린 견적 품목·단가 참고" },
  { icon: Bot, label: "자동화 작업", desc: "사진 올려두면 AI가 알아서 처리, 개인 작업 일지도 여기서" },
] as const;

/** 첫 방문 안내 — 이 앱에 뭐가 있는지 한 번만 짧게 보여준다. 매번 뜨면 거슬리므로
 *  localStorage에 본 적이 있다고 적어두고 다시는 띄우지 않는다(기기별로 한 번). */
export default function FeatureIntroDialog({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm foldLandscape:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-center text-[17px] font-bold text-slate-900">이런 기능도 있어요</h2>
        <p className="mt-1 text-center text-[13px] text-slate-500">위쪽 아이콘과 화면 속 버튼에서 바로 열 수 있어요</p>

        <ul className="mt-5 space-y-4">
          {ITEMS.map(({ icon: Icon, label, desc }) => (
            <li key={label} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-slate-900">{label}</p>
                <p className="text-[12.5px] leading-snug text-slate-500">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
        >
          확인했어요
        </button>
      </div>
    </div>
  );
}
