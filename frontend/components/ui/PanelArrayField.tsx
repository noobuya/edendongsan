"use client";

import { Plus, Trash2 } from "lucide-react";
import type { DoorType, PanelItem } from "@/types";
import { NumberField } from "@/components/ui/FormControls";

const DOOR_TYPE_OPTIONS: { value: DoorType; label: string; hint: string }[] = [
  { value: "flat", label: "민짜문", hint: "통판 한 장" },
  { value: "lattice", label: "알판·격자문", hint: "인건비 할증" },
  { value: "glass", label: "타공문(유리)", hint: "인건비 할증" },
];

interface Props {
  items: PanelItem[];
  onChange: (items: PanelItem[]) => void;
  countLabel?: string;
  addLabel: string;
  /** 자주 쓰는 규격. 손으로 치는 대신 눌러서 넣는다 —
   *  현장에서 치수를 잘못 넣으면 견적이 통째로 틀어진다(150×300mm 문틀처럼). */
  presets?: { label: string; widthMm: number; heightMm: number }[];
  /** true면 항목마다 "문짝 구조" 선택지를 보여준다 — 알판/격자문·타공문은 홈 굴곡과
   *  겹치기(덧방) 시공 때문에 민짜문보다 시공 시간이 훨씬 오래 걸려, 선택하면 인건비에
   *  난이도 할증이 자동으로 붙는다(자재 소요량은 실측 면적 그대로라 그대로 둔다).
   *  문짝이 아닌 항목(문틀·상하부장·벽 등)에는 의미가 없어 기본으로는 꺼 둔다. */
  showDoorType?: boolean;
}

export default function PanelArrayField({
  items,
  onChange,
  countLabel = "개수",
  addLabel,
  presets,
  showDoorType,
}: Props) {
  function updateItem(idx: number, patch: Partial<PanelItem>) {
    onChange(items.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function addItem() {
    onChange([...items, { widthMm: 0, heightMm: 0, count: 1 }]);
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={idx} className="space-y-2 border-b border-slate-900/[0.06] pb-3 last:border-0 last:pb-0">
          <div className="flex items-end gap-3">
            <div className="grid flex-1 grid-cols-3 gap-2.5">
              <NumberField
                label="가로"
                unit="mm"
                value={item.widthMm}
                onChange={(widthMm) => updateItem(idx, { widthMm })}
              />
              <NumberField
                label="세로"
                unit="mm"
                value={item.heightMm}
                onChange={(heightMm) => updateItem(idx, { heightMm })}
              />
              <NumberField label={countLabel} value={item.count} onChange={(count) => updateItem(idx, { count })} />
            </div>
            <button
              type="button"
              onClick={() => removeItem(idx)}
              aria-label="삭제"
              className="flex h-14 w-12 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors active:bg-red-50 active:text-red-500"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>

          {/* 문짝 구조 — 알판/격자문·타공문을 고르면 인건비에 난이도 할증이 자동으로 붙는다.
              홈이 파인 문은 세로 기둥·가로대·알판을 따로 재단해 겹쳐 붙이는 덧방 시공이라
              통판(민짜문)보다 시공 시간이 2~3배 걸리기 때문이다. */}
          {showDoorType && (
            <div className="flex flex-wrap gap-1.5">
              {DOOR_TYPE_OPTIONS.map((opt) => {
                const active = (item.doorType ?? "flat") === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateItem(idx, { doorType: opt.value })}
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                      active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {opt.label}
                    {opt.value !== "flat" && (
                      <span className={active ? "ml-1 font-normal text-indigo-100" : "ml-1 font-normal text-slate-400"}>
                        {opt.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      {/* 테두리만 있는 버튼은 눌러도 되는지 애매해 보인다 — 연한 브랜드 색을 채운
          덩어리로 만들어 "여기를 누르면 한 줄이 늘어난다"가 바로 읽히게 한다. */}
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() =>
                onChange([...items, { widthMm: p.widthMm, heightMm: p.heightMm, count: 1 }])
              }
              className="rounded-full border border-indigo-200 bg-indigo-50/60 px-3.5 py-2 text-[12px] font-semibold text-indigo-700 transition-transform active:scale-95"
            >
              + {p.label}
              <span className="ml-1 font-normal text-indigo-400">
                {p.widthMm}×{p.heightMm}
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addItem}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-50 py-4 text-[15px] font-semibold text-indigo-600 transition-transform active:scale-[0.98]"
      >
        <Plus className="h-5 w-5" strokeWidth={2.5} />
        {addLabel}
      </button>
    </div>
  );
}
