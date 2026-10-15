"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";

const ROLL_SIZES_M = [50, 30, 25] as const;

const FIELD =
  "w-full min-w-0 border-0 border-b border-slate-900/10 bg-transparent px-0 pb-3 pt-2 text-[17px] font-light text-slate-900 outline-none transition-colors placeholder:font-light placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0";

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** 자재 발주는 늘 롤(박스) 단위로만 끊어 살 수 있다 — 필요한 길이를 그대로
 *  주문할 수 없으니, 몇 롤을 시켜야 하는지(올림), 남는 로스가 몇 m인지,
 *  그래서 총 얼마를 결제해야 하는지를 현장에서 바로 계산한다. */
export default function MaterialOrderCalculator() {
  const [open, setOpen] = useState(false);
  const [neededM, setNeededM] = useState("");
  const [pricePerM, setPricePerM] = useState("");
  const [rollSize, setRollSize] = useState<number>(50);

  const needed = Number(neededM) || 0;
  const price = Number(pricePerM) || 0;
  const boxes = needed > 0 ? Math.ceil(needed / rollSize) : 0;
  const lossM = boxes > 0 ? boxes * rollSize - needed : 0;
  const totalCost = boxes * rollSize * price;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-white text-[13px] font-semibold text-indigo-600 shadow-sm"
      >
        <Calculator className="h-4 w-4" />
        자재 발주·로스 계산기
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="자재 발주·로스 계산기"
        description="필요한 길이와 1롤 규격을 넣으면 몇 롤을 시켜야 하는지, 발주 금액까지 바로 나와요."
      >
        <div className="space-y-7">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              필요 수량 (m)
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={neededM}
              onChange={(e) => setNeededM(e.target.value)}
              placeholder="예) 72"
              className={FIELD}
            />
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              m당 단가 (원)
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={pricePerM}
              onChange={(e) => setPricePerM(e.target.value)}
              placeholder="예) 10000"
              className={FIELD}
            />
          </label>

          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              1롤(박스) 규격
            </span>
            <div className="mt-2 flex gap-1 rounded-full bg-slate-900/[0.06] p-1">
              {ROLL_SIZES_M.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setRollSize(size)}
                  className={`flex-1 rounded-full py-2.5 text-[13px] transition-all duration-200 ${
                    rollSize === size
                      ? "bg-white font-semibold text-indigo-600 shadow-[0_2px_10px_rgba(0,0,0,0.08)]"
                      : "font-light text-slate-500"
                  }`}
                >
                  {size}m
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-900/[0.05] bg-slate-50 p-5">
            <div className="flex items-center justify-between text-[14px]">
              <span className="font-light text-slate-500">필요 박스 수</span>
              <span className="font-bold text-slate-900">{boxes}롤</span>
            </div>
            <div className="flex items-center justify-between text-[14px]">
              <span className="font-light text-slate-500">남는 자재(로스)</span>
              <span className="font-bold text-slate-900">{lossM.toFixed(1)}m</span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-900/[0.06] pt-3 text-[15px]">
              <span className="font-semibold text-slate-700">총 발주 금액</span>
              <span className="text-[18px] font-bold text-indigo-600">{won(totalCost)}</span>
            </div>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
