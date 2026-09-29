"use client";

import type { PatternSwatch } from "@/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  swatches: PatternSwatch[];
  selectedId?: string;
  onSelect: (id: string) => void;
  size?: "sm" | "md";
}

/** swatches를 화면에 그릴 순서 그대로 "브랜드별 묶음"으로 나눈다 — brand가 없는
 *  항목(기본 색상 10종)은 첫 묶음(label 없음)으로, 그 뒤로는 brand가 바뀔 때마다
 *  새 묶음을 연다. 정렬은 하지 않는다 — 입력 배열 순서(ALL_PATTERN_SWATCHES가 정한
 *  "기본 색상 -> 현대보닥" 순서)를 그대로 존중해야 브랜드 섹션이 뒤섞이지 않는다. */
function groupByBrand(swatches: PatternSwatch[]): { label: string | null; items: PatternSwatch[] }[] {
  const groups: { label: string | null; items: PatternSwatch[] }[] = [];
  for (const s of swatches) {
    const label = s.brand ?? null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(s);
    } else {
      groups.push({ label, items: [s] });
    }
  }
  return groups;
}

export default function SwatchPicker({ swatches, selectedId, onSelect, size = "md" }: Props) {
  // 색을 고르는 자리이므로 색 위에 아무것도 얹지 않는다 — 예전에는 선택 표시로
  // 체크 아이콘을 색 위에 그려 정작 색이 가려졌다. 대신 스와치 바깥에 포커스 링을
  // 둘러 "무엇이 선택됐는지"를 색을 가리지 않고 보여준다.
  const dim = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  const groups = groupByBrand(swatches);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        {groups.map((group, groupIdx) => (
          <div key={group.label ?? `basic-${groupIdx}`}>
            {/* 실제 제조사 브랜드(현대보닥 등)만 이름표를 단다 — 기본 색상 10종은
                예전처럼 이름표 없이 바로 스와치 줄만 보인다. */}
            {group.label && (
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {group.items.map((s) => {
                const selected = s.id === selectedId;
                return (
                  <Tooltip key={s.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelect(s.id)}
                        aria-pressed={selected}
                        aria-label={s.code ? `${s.name} (${s.code})` : s.name}
                        className={`${dim} shrink-0 rounded-full border border-black/5 shadow-sm ring-offset-2 ring-offset-white transition-all duration-150 hover:scale-105 ${
                          selected
                            ? "scale-105 ring-2 ring-indigo-600"
                            : "ring-0 hover:ring-2 hover:ring-slate-200"
                        }`}
                        style={{ backgroundColor: s.colorHex }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{s.code ? `${s.name} (${s.code})` : s.name}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
