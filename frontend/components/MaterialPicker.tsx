"use client";

import { useState } from "react";
import { Check, ChevronLeft, PenLine, X } from "lucide-react";
import type { MappedRegion, WorkItemId } from "@/types";
import { DOOR_MATERIAL_OPTIONS, MATERIAL_OPTIONS, REGION_COLORS, WORK_ITEM_GROUPS, WORK_ITEM_META } from "@/lib/workItems";

interface Props {
  regions: MappedRegion[];
  onRemoveRegion: (id: number) => void;
  /** 지금 지정해둔 도형이 있는지 — 없으면 자재를 골라도 묶을 영역이 없다. */
  hasShape: boolean;
  onPickMaterial: (
    category: WorkItemId,
    option: string,
    optionLabel: string,
    customDesign: string,
    doorMaterial?: "wood" | "steel"
  ) => void;
}

/** 자재까지는 골랐고, 이제 문구/그림을 받는 중인 상태. */
interface PendingPick {
  category: WorkItemId;
  option: string;
  optionLabel: string;
  /** door_frame에서만 쓴다 — DOOR_MATERIAL_OPTIONS의 id(화면 선택 상태 구분용). */
  doorMaterialOptionId: string;
}

type MaterialOption = { id: string; label: string; colorHex?: string; brand?: string; code?: string };

/** 자재 목록을 화면에 그릴 순서 그대로 "브랜드별 묶음"으로 나눈다 — brand가 없는
 *  기본 항목은 첫 묶음(이름표 없음)으로, 그 뒤로는 brand가 바뀔 때마다 새 묶음을
 *  연다. 정렬하지 않는다 — MATERIAL_OPTIONS가 정한 "기본 색상 -> 현대보닥" 순서를
 *  그대로 존중해야 브랜드 섹션이 뒤섞이지 않는다. */
function groupMaterialsByBrand(options: MaterialOption[]): { label: string | null; items: MaterialOption[] }[] {
  const groups: { label: string | null; items: MaterialOption[] }[] = [];
  for (const opt of options) {
    const label = opt.brand ?? null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(opt);
    } else {
      groups.push({ label, items: [opt] });
    }
  }
  return groups;
}

/** 도형으로 잡아둔 구역에 "무엇을 시공할지" 정하는 패널.
 *
 *  2단계(처음 견적)와 3단계(결과를 다시 손보기)가 똑같은 화면을 써야 하므로 따로
 *  떼어 두었다 — 한쪽만 고쳐서 두 화면이 달라지는 일을 막는다. */
export default function MaterialPicker({
  regions,
  onRemoveRegion,
  hasShape,
  onPickMaterial,
}: Props) {
  const [pending, setPending] = useState<PendingPick | null>(null);
  const [customDesign, setCustomDesign] = useState("");
  // 큰 종목(인테리어 필름 등)을 먼저 고르고, 그 안에서 부위를 고른다.
  // 부위가 하나뿐인 종목은 이 단계를 건너뛴다 — 누를 게 하나인 화면은 군더더기다.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  function closePick() {
    setPending(null);
    setOpenGroup(null);
  }

  function beginPick(category: WorkItemId) {
    // 첫 자재를 기본으로 골라 둔다 — 색상을 안 건드려도 바로 적용할 수 있어야 한다.
    const first = MATERIAL_OPTIONS[category][0];
    setPending({ category, option: first.id, optionLabel: first.label, doorMaterialOptionId: "wood" });
    setCustomDesign("");
  }

  function applyPick() {
    if (!pending) return;
    const doorMaterial =
      pending.category === "door_frame"
        ? DOOR_MATERIAL_OPTIONS.find((d) => d.id === pending.doorMaterialOptionId)?.material ?? "wood"
        : undefined;
    onPickMaterial(pending.category, pending.option, pending.optionLabel, customDesign.trim(), doorMaterial);
    setPending(null);
    setOpenGroup(null);
    setCustomDesign("");
  }

  const group = WORK_ITEM_GROUPS.find((g) => g.id === openGroup) ?? null;

  return (
    <div className="space-y-5">
          {/* 자재 선택 — 칠한 자국이 있어야 누를 수 있다 */}
          <div
            className={`rounded-2xl border p-4 transition-colors ${
              hasShape ? "border-indigo-200 bg-indigo-50/60" : "border-slate-900/[0.06] bg-white/40"
            }`}
          >
            <p className="text-[12px] font-semibold text-slate-700">
              {pending
                ? `${pending.optionLabel} — 추가로 요청할 내용이 있나요?`
                : hasShape
                  ? "지정한 도형에 시공할 자재를 고르세요"
                  : "먼저 사진에서 시공할 구역을 도형으로 그리세요"}
            </p>

            {/* 항목을 고른 뒤 한 단계 더 — 이 구역에 대한 추가 요청을 받는다.
                시트지·썬팅이면 그 면에 새길 로고나 문구가 되고, 실링팬·조명·싱크볼이면
                물건의 모양과 스타일이 된다(백엔드 ai_service.compose_prompt가
                task_type을 보고 붙이는 자리를 바꾼다). 모든 종목에서 똑같이 뜬다.
                비워두고 적용하면 지금까지처럼 고른 항목 그대로 시공된다. */}
            {pending ? (
              /* [한 화면에서 끝낸다]
                 예전에는 항목 -> (뒤로가기 화면) -> 색상 -> 입력창으로 단계가 나뉘어,
                 '인테리어 필름'을 누르면 색상 고르는 곳이 어디 있는지 보이지 않았다.
                 이제 색상 칩과 추가 요청 입력창이 한 화면에 같이 뜬다. */
              <div className="mt-3 space-y-4">
                <button
                  type="button"
                  onClick={closePick}
                  className="flex items-center gap-1 text-[12px] font-semibold text-slate-500"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {WORK_ITEM_META[pending.category].label}
                </button>

                <div className="space-y-3">
                  {/* 실제 제조사 브랜드가 있는 옵션(현대보닥 등)은 묶어서 이름표를 단다 —
                      "기본 색상"은 일반명뿐이라 이름표 없이 바로 보여주고, 그 뒤로
                      브랜드가 바뀔 때마다 "현대보닥(BODAQ)"처럼 새 이름표가 붙는다.
                      화면에서 고른 게 실제 어느 제품인지(코드까지) 그대로 보여야
                      현장에서 자재 발주서에 옮길 수 있다. */}
                  {groupMaterialsByBrand(MATERIAL_OPTIONS[pending.category]).map((group, idx) => (
                    <div key={group.label ?? `basic-${idx}`}>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        {group.label ?? "색상 · 자재"}
                      </span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {group.items.map((opt) => {
                          const active = opt.id === pending.option;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                setPending({ ...pending, option: opt.id, optionLabel: opt.label })
                              }
                              className={`flex items-center gap-1.5 rounded-full border py-2 pl-2 pr-3.5 text-[12px] transition-all active:scale-95 ${
                                active
                                  ? "border-indigo-600 bg-indigo-600 font-semibold text-white shadow-[0_4px_14px_rgba(79,70,229,0.35)]"
                                  : "border-slate-900/10 bg-white/80 font-medium text-slate-700"
                              }`}
                            >
                              <span
                                className={`h-4 w-4 shrink-0 rounded-full border ${
                                  active ? "border-white/60" : "border-black/10"
                                }`}
                                style={{ backgroundColor: opt.colorHex ?? "#cbd5e1" }}
                              />
                              {opt.label}
                              {opt.code && (
                                <span className={active ? "font-normal text-indigo-100" : "font-normal text-slate-400"}>
                                  {opt.code}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 문짝/문틀에서만 — 나무 문(방문)인지, 페인트칠한 스틸 문(현관문·방화문)인지.
                    AI 편집 지시문이 문 재질에 맞는 문장을 쓰도록 갈라 준다(스틸 문에는
                    없는 나뭇결을 없애라고 하면 AI가 헷갈려 결과가 이상하게 나온다). */}
                {pending.category === "door_frame" && (
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      문 종류
                    </span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {DOOR_MATERIAL_OPTIONS.map((opt) => {
                        const active = opt.id === pending.doorMaterialOptionId;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setPending({ ...pending, doorMaterialOptionId: opt.id })}
                            className={`rounded-full border px-3.5 py-2 text-[12px] transition-all active:scale-95 ${
                              active
                                ? "border-indigo-600 bg-indigo-600 font-semibold text-white shadow-[0_4px_14px_rgba(79,70,229,0.35)]"
                                : "border-slate-900/10 bg-white/80 font-medium text-slate-700"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <label className="block">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <PenLine className="h-3 w-3" />
                    추가 요청사항 (선택사항)
                  </span>
                  <textarea
                    value={customDesign}
                    onChange={(e) => setCustomDesign(e.target.value)}
                    rows={2}
                    placeholder="예) 카페 로고, 우드톤 5엽 실링팬, 사각 싱크볼 등"
                    className="mt-1 w-full resize-none border-0 border-b border-slate-900/10 bg-transparent px-0 pb-2 pt-1.5 text-[13px] font-light leading-relaxed text-slate-900 outline-none transition-colors placeholder:font-light placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0"
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closePick}
                    className="rounded-xl px-3 py-2.5 text-[12px] font-semibold text-slate-500 transition-transform active:scale-95"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={applyPick}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-[12px] font-semibold text-white shadow-[0_6px_20px_rgba(79,70,229,0.35)] transition-transform active:scale-[0.98]"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {pending.optionLabel} 적용하기
                  </button>
                </div>
              </div>
            ) : group ? (
              /* 2뎁스: 고른 종목 안에서 "어느 부위"인지 */
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setOpenGroup(null)}
                  className="flex items-center gap-1 text-[12px] font-semibold text-slate-500"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {group.label}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {group.children.map((item) => {
                    const meta = WORK_ITEM_META[item];
                    const Icon = meta.icon;
                    return (
                      <button
                        key={item}
                        type="button"
                        disabled={!hasShape}
                        onClick={() => beginPick(item)}
                        className="flex items-center gap-2 rounded-xl border border-slate-900/[0.05] bg-white/70 px-3 py-3 text-left transition-all active:scale-[0.98] disabled:opacity-40"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-indigo-500" />
                        <span className="truncate text-[12px] font-semibold text-slate-800">{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* 1뎁스: 큰 종목 고르기 */
              <div className="mt-3 grid grid-cols-2 gap-2">
                {WORK_ITEM_GROUPS.map((g) => {
                  const Icon = g.icon;
                  const single = g.children.length === 1 ? g.children[0] : null;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      disabled={!hasShape}
                      onClick={() => (single ? beginPick(single) : setOpenGroup(g.id))}
                      className="flex items-center gap-2 rounded-xl border border-slate-900/[0.05] bg-white/70 px-3 py-3 text-left transition-all active:scale-[0.98] disabled:opacity-40"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-indigo-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-slate-800">
                          {single ? WORK_ITEM_META[single].label : g.label}
                        </span>
                        {!single && (
                          <span className="block truncate text-[11px] font-light text-slate-400">
                            {g.children.length}개 부위
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 매핑된 영역 칩 목록 */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              지정한 영역 {regions.length > 0 && `(${regions.length})`}
            </p>
            {regions.length === 0 ? (
              <p className="mt-2 text-[13px] font-light text-slate-400">아직 지정한 영역이 없습니다</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {regions.map((region) => {
                  const color = REGION_COLORS[region.colorIndex % REGION_COLORS.length];
                  return (
                    <span
                      key={region.id}
                      className="flex max-w-full items-center gap-1.5 rounded-full py-1.5 pl-3 pr-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: color.stroke }}
                    >
                      <span className="truncate">
                        {region.optionLabel}
                        {/* 같은 자재를 여러 구역에 쓰면 칩이 똑같아 보인다 —
                            요청한 디자인을 붙여야 어느 구역인지 구분된다. */}
                        {region.customDesign && (
                          <span className="font-normal opacity-80"> · {region.customDesign}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveRegion(region.id)}
                        aria-label={`${region.optionLabel} 삭제`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/25 transition-transform active:scale-90"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
  );
}
