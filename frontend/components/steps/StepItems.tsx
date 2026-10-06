"use client";

import { useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import type { JobOptionsState, WorkItemId } from "@/types";
import ItemPickerSheet from "@/components/ItemPickerSheet";
import ItemOptionsSheet from "@/components/ItemOptionsSheet";
import { ALL_WORK_ITEMS, WORK_ITEM_META, summarizeItem, visibleWorkGroups } from "@/lib/workItems";

interface Props {
  selectedItems: WorkItemId[];
  onSelectedItemsChange: (items: WorkItemId[]) => void;
  options: JobOptionsState;
  onOptionsChange: (options: JobOptionsState) => void;
  /** 사장님 기기 여부. 아니면 일러스트 종목은 목록에도 선택지에도 나오지 않는다. */
  isOwner: boolean;
}

/** 2단계 — 시공 항목 세팅. 고른 항목만 카드로 쌓이고, 상세 입력은 시트에서 한다. */
export default function StepItems({
  selectedItems,
  onSelectedItemsChange,
  options,
  onOptionsChange,
  isOwner,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkItemId | null>(null);

  const groups = visibleWorkGroups(isOwner);
  const ordered = ALL_WORK_ITEMS.filter(
    (id) => selectedItems.includes(id) && groups.some((g) => g.children.includes(id))
  );

  function toggleItem(item: WorkItemId) {
    onSelectedItemsChange(
      selectedItems.includes(item)
        ? selectedItems.filter((i) => i !== item)
        : [...selectedItems, item]
    );
  }

  return (
    <div className="animate-[step-in_0.3s_ease-out]">
      <div className="mb-7">
        <div>
          <h2 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">시공 항목</h2>
          <p className="mt-2 text-[14px] font-light text-slate-500">
            {ordered.length > 0
              ? `${ordered.length}개 항목 · 카드를 눌러 상세를 입력하세요`
              : "오른쪽 아래 + 버튼으로 항목을 추가하세요"}
          </p>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-5 py-14 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-900/[0.06] bg-white/60">
            <Plus className="h-7 w-7 text-indigo-500" strokeWidth={2} />
          </span>
          <div>
            <p className="text-[17px] font-semibold tracking-tight text-slate-900">아직 추가한 항목이 없습니다</p>
            <p className="mt-1.5 text-[13px] font-light text-slate-500">필름, 조명, 유리 썬팅 등을 골라주세요</p>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="h-12 rounded-full bg-indigo-600 px-7 text-[15px] font-semibold text-white shadow-[0_8px_30px_rgba(79,70,229,0.4)] transition-transform active:scale-[0.98]"
          >
            항목 추가하기
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {ordered.map((item, index) => {
            const meta = WORK_ITEM_META[item];
            // 같은 큰 종목이 이어지면 그 위에 한 번만 머리글을 얹는다.
            // 필름 계열 부위가 넷이라 머리글이 없으면 "샷시가 왜 여기 있지" 싶어진다.
            const groupOf = (id: WorkItemId) =>
              groups.find((g) => g.children.includes(id));
            const group = groupOf(item);
            const showHeading =
              !!group &&
              group.children.length > 1 &&
              (index === 0 || groupOf(ordered[index - 1])?.id !== group.id);
            const Icon = meta.icon;
            return (
              <div key={item}>
                {showHeading && group && (
                  <p className="mb-1.5 mt-3 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 first:mt-0">
                    {group.label}
                  </p>
                )}
                <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(item)}
                  className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl border border-slate-900/[0.05] bg-white/55 p-4 text-left transition-all active:scale-[0.99] active:bg-white/80"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* 좁은 화면에서 "유리 썬팅/일러스트" 같은 긴 이름이 두 줄로 접히면
                        카드 높이가 제각각이 되어 목록이 지저분해진다. */}
                    <span className="block truncate text-[15px] font-semibold tracking-tight text-slate-900">
                      {meta.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] font-light text-slate-500">
                      {summarizeItem(item, options)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleItem(item)}
                  aria-label={`${meta.label} 제거`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-900/[0.05] bg-white/55 text-slate-400 transition-transform active:scale-90"
                >
                  <X className="h-5 w-5" />
                </button>
                </div>
              </div>
            );
          })}
          {/* FAB(오른쪽 아래 + 버튼)가 마지막 항목 글자를 덮지 않도록 비워두는 자리.
              버튼은 fixed라 목록 위에 떠 있어서, 여백이 없으면 끝까지 스크롤해도
              마지막 줄이 버튼 밑에 깔린 채로 남는다. */}
          <div aria-hidden className="h-20 foldLandscape:h-16" />
        </div>
      )}

      {/* 항목이 하나라도 있으면 FAB로 추가한다. 화면 아래 오른쪽은 엄지가 가장 편한
          자리라, 목록이 길어져도 스크롤 없이 바로 누를 수 있다. */}
      {ordered.length > 0 && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label="시공 항목 추가"
          className="fixed bottom-32 right-8 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-[0_10px_40px_rgba(79,70,229,0.5)] transition-transform active:scale-90 foldLandscape:bottom-28 foldLandscape:right-12"
        >
          <Plus className="h-7 w-7" strokeWidth={2.5} />
        </button>
      )}

      <ItemPickerSheet
        open={pickerOpen}
        selected={selectedItems}
        onToggle={toggleItem}
        onClose={() => setPickerOpen(false)}
        isOwner={isOwner}
      />
      <ItemOptionsSheet
        item={editingItem}
        options={options}
        onChange={onOptionsChange}
        onClose={() => setEditingItem(null)}
      />
    </div>
  );
}
