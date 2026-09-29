"use client";

import { useEffect, useState } from "react";
import { Lock, Minus, Plus, X } from "lucide-react";

const GONG_RATE = 300_000; // 기공 일당
const JOGONG_RATE = 100_000; // 조공 일당

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function Stepper({
  value,
  unit,
  max,
  onChange,
}: {
  value: number;
  unit: string;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <span className="flex h-11 items-center rounded-xl bg-[#f2f4f6] px-1">
      <button
        type="button"
        aria-label={`${unit} 줄이기`}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[#4e5968] transition-colors active:bg-white"
      >
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="min-w-[2.6rem] text-center text-[15px] font-bold tabular-nums text-[#191f28]">
        {value}
        {unit}
      </span>
      <button
        type="button"
        aria-label={`${unit} 늘리기`}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[#4e5968] transition-colors active:bg-white"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </span>
  );
}

/** 사장님 전용 내부 분석 시트 — 총 견적에서 자재비와 기공/조공 일당을 빼고 순수익을 실시간으로 보여준다.
 *  고객에게 보이는 견적서(영수증)와 별개로, 총액을 더블 탭하거나 길게 눌러야만 열린다. */
export default function CrewSimulator({
  open,
  seedTotal,
  materialRatio,
  filmMeters,
  onClose,
}: {
  open: boolean;
  seedTotal: number;
  materialRatio: number;
  /** 품목을 골랐을 때만 알 수 있다. 평수별 견적에서는 null. */
  filmMeters: number | null;
  onClose: () => void;
}) {
  const [total, setTotal] = useState(seedTotal);
  const [gongCount, setGongCount] = useState(1);
  const [gongDays, setGongDays] = useState(3);
  const [joCount, setJoCount] = useState(1);
  const [joDays, setJoDays] = useState(3);

  // 패널을 열 때마다 그때의 견적 금액으로 다시 시작한다.
  useEffect(() => {
    if (open) setTotal(seedTotal);
  }, [open, seedTotal]);

  if (!open) return null;

  const material = Math.round(total * materialRatio);
  const gongCost = GONG_RATE * gongCount * gongDays;
  const joCost = JOGONG_RATE * joCount * joDays;
  const profit = total - material - gongCost - joCost;
  const matPct = Math.round(materialRatio * 100);

  const crews = [
    { label: "기공", rate: "일 30만원", count: gongCount, days: gongDays, setCount: setGongCount, setDays: setGongDays, cost: gongCost },
    { label: "조공", rate: "일 10만원", count: joCount, days: joDays, setCount: setJoCount, setDays: setJoDays, cost: joCost },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <button type="button" aria-label="내부 분석 닫기" onClick={onClose} className="fin-backdrop absolute inset-0 cursor-default bg-black/30" />
      <section
        role="dialog"
        aria-label="내부 분석"
        className="fin-sheet relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-[#191f28] shadow-[0_-12px_40px_rgba(25,31,40,0.18)]"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#d1d6db]" />
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-orange-800">
            <Lock className="h-[18px] w-[18px]" strokeWidth={2} />
            내부 분석
            <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[11px] font-semibold text-orange-700">고객 비공개</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f2f4f6] text-[#4e5968]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-orange-50 px-4 py-3.5 text-[14px] leading-[1.75] text-orange-900">
          <p className="text-[12px] font-bold text-orange-800">[내부 분석]</p>
          <p>
            원단 소요량{" "}
            <b className="tabular-nums text-[#191f28]">{filmMeters === null ? "품목 선택 시 산출" : `약 ${filmMeters} 미터`}</b>
          </p>
          <p>
            예상 자재비 <b className="tabular-nums text-[#191f28]">{won(material)}</b>
          </p>
          <p>
            시공 마진율{" "}
            <b className="tabular-nums text-[#191f28]">
              {100 - matPct}% ({won(total - material)})
            </b>
          </p>
        </div>

        <label className="mt-4 flex items-center justify-between gap-3 border-b border-[#eef0f2] pb-4 text-[14px] text-[#5b6573]">
          총 견적
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              step={10000}
              value={total}
              onChange={(e) => setTotal(Math.max(0, parseInt(e.target.value || "0", 10)))}
              className="h-11 w-36 rounded-xl border border-[#d1d6db] bg-white px-3 text-right text-[16px] font-bold tabular-nums text-[#191f28]"
            />
            원
          </span>
        </label>

        <div className="flex items-center justify-between border-b border-[#eef0f2] py-4 text-[14px]">
          <span className="text-[#5b6573]">자재비 ({matPct}% 고정)</span>
          <span className="font-bold tabular-nums text-red-600">− {won(material)}</span>
        </div>

        {crews.map((c) => (
          <div key={c.label} className="border-b border-[#eef0f2] py-4">
            <p className="mb-2.5 text-[14px] font-bold">
              {c.label} <span className="ml-1 text-[13px] font-normal text-[#5b6573]">{c.rate}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[14px] text-[#5b6573]">
              <Stepper value={c.count} unit="명" max={9} onChange={c.setCount} />
              <span aria-hidden>×</span>
              <Stepper value={c.days} unit="일" max={30} onChange={c.setDays} />
              <span className="ml-auto font-bold tabular-nums text-[#191f28]">− {won(c.cost)}</span>
            </div>
          </div>
        ))}

        <div className="pt-5 text-center">
          <p className="text-[14px] font-medium text-[#5b6573]">최종 사장님 순수익</p>
          <p
            className={`mt-1 text-[36px] font-extrabold leading-none tracking-[-0.03em] tabular-nums ${
              profit < 0 ? "text-red-600" : "text-blue-600"
            }`}
          >
            {won(profit)}
          </p>
        </div>
      </section>
    </div>
  );
}
