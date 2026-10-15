import { ChevronRight, Palette, ShieldCheck } from "lucide-react";

/** 현대보닥(BODAQ) 공식 3D 시뮬레이터 — 현대엘앤씨가 운영하는 정품 사이트.
 *  대표님이 제안한 필름 외에 다른 컬러도 고객이 직접 둘러볼 수 있게 새 창으로 연다. */
export const BODAQ_SIMULATOR_URL = "https://m.ebodaq.com/Product/Simulation";

/** customer: 고객용 제안서 — 비포/애프터·필름 브랜드 칩 바로 아래 놓는 큰 배너.
 *  owner: 사장님 상담 대시보드 — 다른 퀵메뉴 버튼들과 같은 줄에 놓는 작은 버튼. */
export default function BodaqSimulatorBanner({ variant }: { variant: "customer" | "owner" }) {
  if (variant === "owner") {
    return (
      <a
        href={BODAQ_SIMULATOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-white text-[13px] font-semibold text-indigo-600 shadow-sm"
      >
        <Palette className="h-4 w-4" />
        현대 L&C 공식 컬러 보여주기
      </a>
    );
  }

  return (
    <a
      href={BODAQ_SIMULATOR_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-5 flex items-center gap-3.5 rounded-2xl border border-[#eef0f2] bg-gradient-to-r from-indigo-50 to-white p-4 shadow-sm transition active:scale-[0.99]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
        <Palette className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-bold leading-snug text-slate-900">
          현대보닥 공식 3D 시뮬레이터로 다른 색상 입혀보기
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[12px] font-medium text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          현대엘앤씨 정품 보닥 사이트로 바로 연결돼요
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </a>
  );
}
