"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { WorkItemId } from "@/types";
import BottomSheet from "@/components/ui/BottomSheet";
import { WORK_ITEM_GROUPS, WORK_ITEM_META } from "@/lib/workItems";

interface Props {
  open: boolean;
  selected: WorkItemId[];
  onToggle: (item: WorkItemId) => void;
  onClose: () => void;
}

/** FAB(+)를 누르면 올라오는 시공 항목 선택 시트. */
export default function ItemPickerSheet({ open, selected, onToggle, onClose }: Props) {
  // 큰 종목을 먼저 고르고 그 안에서 부위를 고른다. 필름 계열은 자재가 같고 부위만
  // 다른데 한 줄로 늘어놓으면 "샷시도 필름인가?"부터 헷갈린다.
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const group = WORK_ITEM_GROUPS.find((g) => g.id === openGroupId) ?? null;

  function close() {
    setOpenGroupId(null);
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title="시공 항목 추가"
      description={
        group
          ? `${group.label} — 어느 부위를 시공하시나요?`
          : "이 현장에서 진행할 항목을 골라주세요. 나중에 다시 바꿀 수 있습니다."
      }
      footer={
        <button
          type="button"
          onClick={close}
          className="h-14 w-full rounded-full bg-slate-900 text-[15px] font-semibold text-white shadow-[0_10px_30px_rgba(15,23,42,0.3)] transition-transform active:scale-[0.98]"
        >
          완료
        </button>
      }
    >
      <div className="space-y-2.5">
        {group ? (
          <>
            <button
              type="button"
              onClick={() => setOpenGroupId(null)}
              className="flex items-center gap-1 px-1 pb-1 text-[13px] font-semibold text-slate-500"
            >
              <ChevronLeft className="h-4 w-4" />
              전체 종목
            </button>
            {group.children.map((item) => (
              <ItemRow
                key={item}
                item={item}
                isOn={selected.includes(item)}
                onClick={() => onToggle(item)}
              />
            ))}
          </>
        ) : (
          WORK_ITEM_GROUPS.map((g) => {
            // 부위가 하나뿐인 종목은 한 단계를 건너뛰고 바로 켜고 끈다 —
            // 누를 게 하나인 화면을 한 번 더 보여줄 이유가 없다.
            if (g.children.length === 1) {
              const item = g.children[0];
              return (
                <ItemRow
                  key={g.id}
                  item={item}
                  isOn={selected.includes(item)}
                  onClick={() => onToggle(item)}
                />
              );
            }
            const Icon = g.icon;
            const picked = g.children.filter((c) => selected.includes(c)).length;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setOpenGroupId(g.id)}
                className={`flex w-full items-center gap-4 rounded-2xl px-4 py-4 text-left transition-all active:scale-[0.99] ${
                  picked > 0 ? "bg-indigo-50" : "border border-slate-900/[0.05] bg-white/50"
                }`}
              >
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                    picked > 0 ? "bg-indigo-600 text-white" : "bg-white text-slate-400"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold tracking-tight text-slate-900">{g.label}</span>
                  <span className="mt-0.5 block truncate text-[13px] font-light text-slate-500">
                    {picked > 0 ? `${g.children.length}개 부위 · ${picked}개 선택됨` : `${g.children.length}개 부위`}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
              </button>
            );
          })
        )}
      </div>
    </BottomSheet>
  );
}

/** 항목 한 줄 — 큰 종목 안에서도, 부위가 하나뿐인 종목에서도 같은 모양으로 쓴다. */
function ItemRow({
  item,
  isOn,
  onClick,
}: {
  item: WorkItemId;
  isOn: boolean;
  onClick: () => void;
}) {
  const meta = WORK_ITEM_META[item];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isOn}
      className={`flex w-full items-center gap-4 rounded-2xl px-4 py-4 text-left transition-all active:scale-[0.99] ${
        isOn ? "bg-indigo-50" : "border border-slate-900/[0.05] bg-white/50"
      }`}
    >
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
          isOn ? "bg-indigo-600 text-white" : "bg-white text-slate-400"
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold tracking-tight text-slate-900">{meta.label}</span>
        <span className="mt-0.5 block truncate text-[13px] font-light text-slate-500">{meta.description}</span>
      </span>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
          isOn ? "bg-indigo-600 text-white" : "bg-slate-200 text-transparent"
        }`}
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    </button>
  );
}
