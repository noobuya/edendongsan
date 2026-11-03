"use client";

import { useState } from "react";
import { ChevronRight, Mic, Plus, X } from "lucide-react";
import type { ConstructionIntentResult, JobOptionsState, WorkItemId } from "@/types";
import ItemPickerSheet from "@/components/ItemPickerSheet";
import ItemOptionsSheet from "@/components/ItemOptionsSheet";
import VoiceIntentSheet from "@/components/VoiceIntentSheet";
import { ALL_WORK_ITEMS, WORK_ITEM_META, mergeParsedPanels, summarizeItem, visibleWorkGroups } from "@/lib/workItems";

interface Props {
  selectedItems: WorkItemId[];
  onSelectedItemsChange: (items: WorkItemId[]) => void;
  options: JobOptionsState;
  onOptionsChange: (options: JobOptionsState) => void;
  /** 사장님 기기 여부. 아니면 일러스트 종목은 목록에도 선택지에도 나오지 않는다. */
  isOwner: boolean;
}

/** 2단계 — 시공 항목 세팅. 고른 항목만 카드로 쌓이고, 상세 입력은 시트에서 한다. */
export default function StepItems({ selectedItems, onSelectedItemsChange, options, onOptionsChange, isOwner }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkItemId | null>(null);
  // [항목 추가 -> 완료 -> 다시 들어가기 번거로움 해소]
  // 예전에는 "항목 추가" 시트에서 켜고 완료를 누르면 시트가 그냥 닫히기만 해서,
  // 색상/규격을 넣으려면 목록에서 그 카드를 다시 한 번 눌러 들어가야 했다.
  // 이제 "항목 추가" 시트가 열려 있는 동안 새로 켠 항목들을 이 큐에 쌓아 두고,
  // 완료를 누르는 순간 바로 첫 항목의 색상/규격 시트를 연다. 그 시트에서
  // [입력 완료]를 누르면 큐에 남은 다음 항목을 이어서 연다 — 여러 개를 한 번에
  // 추가해도 전부 끝날 때까지 "추가 -> 입력" 흐름이 끊기지 않는다. 피커가
  // 닫혀 있을 때(목록 카드의 X 버튼 등)의 토글은 큐에 들어가지 않는다.
  const [pendingDetailQueue, setPendingDetailQueue] = useState<WorkItemId[]>([]);

  const groups = visibleWorkGroups(isOwner);
  const ordered = ALL_WORK_ITEMS.filter(
    (id) => selectedItems.includes(id) && groups.some((g) => g.children.includes(id))
  );

  function openPicker() {
    setVoiceOpen(false);
    setPendingDetailQueue([]);
    setPickerOpen(true);
  }

  function openVoice() {
    setPickerOpen(false);
    setVoiceOpen(true);
  }

  /** 말/텍스트로 해석된 항목·초안 치수를 받아 selectedItems/options에 반영하고,
   *  기존 "항목 추가 -> 치수 확인"과 같은 흐름(pendingDetailQueue)으로 이어 붙인다
   *  — 제출 전에 사장님이 AI가 채운 기본값을 훑어보고 고칠 수 있게 하기 위함이다. */
  function applyParsedIntent(result: ConstructionIntentResult) {
    const newItems = result.items.filter((item) => !selectedItems.includes(item));
    if (newItems.length > 0) {
      onSelectedItemsChange([...selectedItems, ...newItems]);
    }
    onOptionsChange(mergeParsedPanels(options, result.panels));
    setVoiceOpen(false);
    setEditingItem(result.items[0] ?? null);
    setPendingDetailQueue(result.items.slice(1));
  }

  function toggleItem(item: WorkItemId) {
    const alreadySelected = selectedItems.includes(item);
    onSelectedItemsChange(
      alreadySelected ? selectedItems.filter((i) => i !== item) : [...selectedItems, item]
    );
    if (!pickerOpen) return;
    setPendingDetailQueue((prev) =>
      alreadySelected ? prev.filter((i) => i !== item) : [...prev, item]
    );
  }

  function closePickerAndOpenDetails() {
    setPickerOpen(false);
    setEditingItem(pendingDetailQueue[0] ?? null);
    setPendingDetailQueue((prev) => prev.slice(1));
  }

  function closeDetailsAndAdvance() {
    if (pendingDetailQueue.length > 0) {
      setEditingItem(pendingDetailQueue[0]);
      setPendingDetailQueue((prev) => prev.slice(1));
    } else {
      setEditingItem(null);
    }
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
            <Mic className="h-7 w-7 text-indigo-500" strokeWidth={2} />
          </span>
          <div>
            <p className="text-[17px] font-semibold tracking-tight text-slate-900">어떤 시공인지 말씀해 주세요</p>
            <p className="mt-1.5 text-[13px] font-light text-slate-500">
              "싱크대 상하부장과 아일랜드를 시공할거다"처럼요
            </p>
          </div>
          <button
            type="button"
            onClick={openVoice}
            className="h-12 rounded-full bg-indigo-600 px-7 text-[15px] font-semibold text-white shadow-[0_8px_30px_rgba(79,70,229,0.4)] transition-transform active:scale-[0.98]"
          >
            말로 설명하기
          </button>
          <button
            type="button"
            onClick={openPicker}
            className="text-[13px] font-semibold text-slate-400 underline underline-offset-2"
          >
            직접 선택할게요
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
          onClick={openVoice}
          aria-label="시공 항목 추가"
          className="fixed bottom-32 right-8 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-[0_10px_40px_rgba(79,70,229,0.5)] transition-transform active:scale-90 foldLandscape:bottom-28 foldLandscape:right-12"
        >
          <Plus className="h-7 w-7" strokeWidth={2.5} />
        </button>
      )}

      <VoiceIntentSheet
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onApply={applyParsedIntent}
        onUsePickerInstead={openPicker}
      />
      <ItemPickerSheet
        open={pickerOpen}
        selected={selectedItems}
        onToggle={toggleItem}
        onClose={closePickerAndOpenDetails}
        isOwner={isOwner}
      />
      <ItemOptionsSheet
        item={editingItem}
        options={options}
        onChange={onOptionsChange}
        onClose={closeDetailsAndAdvance}
      />
    </div>
  );
}
