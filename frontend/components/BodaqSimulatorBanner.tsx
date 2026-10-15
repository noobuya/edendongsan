import { ChevronRight, Palette, ShieldCheck, Sparkles } from "lucide-react";

/** 현대보닥(BODAQ) 공식 3D 시뮬레이터 — 현대엘앤씨가 운영하는 정품 사이트.
 *  대표님이 제안한 필름 외에 다른 컬러도 고객이 직접 둘러볼 수 있게 새 창으로 연다. */
export const BODAQ_SIMULATOR_URL = "https://m.ebodaq.com/Product/Simulation";

/** customer: 고객용 프리미엄 제안서 — 필름 브랜드 칩·견적 요약 아래 놓는 고급스러운
 *  다크 프리미엄 배너. owner: 사장님 상담 대시보드 — 퀵메뉴에 놓는 다크 톤 버튼. */
export default function BodaqSimulatorBanner({ variant }: { variant: "customer" | "owner" }) {
  if (variant === "owner") {
    return (
      <a
        href={BODAQ_SIMULATOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-[13px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
      >
        <Palette className="h-4 w-4 text-indigo-300" />
        현대 L&C 공식 컬러 보여주기
      </a>
    );
  }

  return (
    <a
      href={BODAQ_SIMULATOR_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-5 block overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.35)] transition active:scale-[0.99]"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
        <ShieldCheck className="h-3.5 w-3.5" />
        현대엘앤씨 보닥 정품 인증
      </div>
      <p className="mt-2.5 text-[16px] font-bold leading-snug text-white">
        우리 집, 다른 색상도 궁금하시다면?
      </p>
      <p className="mt-1 text-[13.5px] font-light leading-relaxed text-slate-300">
        대기업 공식 3D 시뮬레이터로 직접 확인해 보세요
      </p>
      <div className="mt-4 flex items-center gap-1.5 text-[13px] font-semibold text-indigo-300">
        <Sparkles className="h-4 w-4" />
        현대보닥 시뮬레이터 바로가기
        <ChevronRight className="h-4 w-4" />
      </div>
    </a>
  );
}
