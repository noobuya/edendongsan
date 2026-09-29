"use client";

import { Sparkles } from "lucide-react";
import type { MappedRegion, RenderMode, WorkItemId } from "@/types";
import MaterialPicker from "@/components/MaterialPicker";

interface Props {
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  autoDescription: string;
  onAutoDescriptionChange: (value: string) => void;
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

/** 2단계 — AI에게 무엇을 어떻게 시공할지 알려주는 화면.
 *  자동은 말로 설명하고, 수동은 사진에 직접 칠해 자재를 지정한다. */
export default function StepMapping({
  mode,
  onModeChange,
  autoDescription,
  onAutoDescriptionChange,
  regions,
  onRemoveRegion,
  hasShape,
  onPickMaterial,
}: Props) {

  return (
    <div className="space-y-7 animate-[step-in_0.35s_ease-out]">
      <div>
        <h2 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">시공 지정</h2>
        <p className="mt-2 text-[14px] font-light text-slate-500">
          {mode === "auto" ? "원하시는 시공을 말로 설명해주세요" : "도형으로 구역을 잡고 자재를 고르세요"}
        </p>
      </div>

      {/* 자동 / 수동 알약 토글 */}
      <div className="flex rounded-full bg-slate-900/[0.06] p-1">
        {(["auto", "manual"] as RenderMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`flex-1 rounded-full py-2.5 text-[13px] transition-all duration-200 ${
              mode === m
                ? "bg-white font-semibold text-indigo-600 shadow-[0_2px_10px_rgba(0,0,0,0.08)]"
                : "font-light text-slate-500"
            }`}
          >
            {m === "auto" ? "자동" : "수동"}
          </button>
        ))}
      </div>

      {mode === "auto" ? (
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              시공 요구사항
            </span>
            <textarea
              value={autoDescription}
              onChange={(e) => onAutoDescriptionChange(e.target.value)}
              rows={7}
              placeholder="예) 상부장과 하부장은 매트 화이트 필름으로 감싸고, 천장에는 실링팬 한 대와 4인치 다운라이트 6개를 달아주세요."
              className="w-full resize-none border-0 border-b border-slate-900/10 bg-transparent px-0 pb-3 pt-2 text-[15px] font-light leading-relaxed text-slate-900 outline-none transition-colors placeholder:font-light placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0"
            />
          </label>
          <p className="flex items-start gap-2 text-[12px] font-light leading-relaxed text-slate-400">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
            AI가 사진에서 부위를 스스로 찾아 적용합니다. 정확한 위치를 직접 지정하려면 수동 모드를 쓰세요.
          </p>
        </div>
      ) : (
        <MaterialPicker
          regions={regions}
          onRemoveRegion={onRemoveRegion}
          hasShape={hasShape}
          onPickMaterial={onPickMaterial}
        />
      )}
    </div>
  );
}
