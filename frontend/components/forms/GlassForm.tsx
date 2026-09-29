"use client";

import type { GlassOptions, GlassTintType, GlassWorkType } from "@/types";
import { FormSection, NumberField, OptionCard } from "@/components/ui/FormControls";
import PanelArrayField from "@/components/ui/PanelArrayField";

const WORK_TYPE_OPTIONS: { id: GlassWorkType; label: string }[] = [
  { id: "tint", label: "썬팅만" },
  { id: "illust", label: "일러스트만" },
  { id: "both", label: "썬팅 + 일러스트" },
];

const TINT_OPTIONS: { id: GlassTintType; label: string; sublabel: string }[] = [
  { id: "clear", label: "투명", sublabel: "자외선 차단" },
  { id: "frosted", label: "반투명", sublabel: "시야 차단" },
  { id: "mirror", label: "미러", sublabel: "반사" },
  { id: "blackout", label: "블랙아웃", sublabel: "암막" },
];

interface Props {
  value: GlassOptions;
  onChange: (value: GlassOptions) => void;
}

export default function GlassForm({ value, onChange }: Props) {
  const needsTint = value.workType === "tint" || value.workType === "both";
  const needsIllust = value.workType === "illust" || value.workType === "both";

  return (
    <div className="space-y-5">
      <FormSection title="시공 종류">
        <div className="grid grid-cols-3 gap-2">
          {WORK_TYPE_OPTIONS.map((opt) => (
            <OptionCard
              key={opt.id}
              label={opt.label}
              selected={value.workType === opt.id}
              onClick={() => onChange({ ...value, workType: opt.id })}
            />
          ))}
        </div>
      </FormSection>

      {needsTint && (
        <>
          <FormSection title="썬팅 필름 종류">
            <div className="grid grid-cols-2 gap-2">
              {TINT_OPTIONS.map((opt) => (
                <OptionCard
                  key={opt.id}
                  label={opt.label}
                  sublabel={opt.sublabel}
                  selected={value.tintType === opt.id}
                  onClick={() => onChange({ ...value, tintType: opt.id })}
                />
              ))}
            </div>
          </FormSection>

          <FormSection title="유리 규격" description="유리문/유리창 한 장의 가로×세로를 입력하세요">
            <PanelArrayField
              items={value.panels}
              onChange={(panels) => onChange({ ...value, panels })}
              addLabel="유리 추가"
            />
          </FormSection>
        </>
      )}

      {needsIllust && (
        <>
          <NumberField
            label="일러스트 시공 건수"
            unit="건"
            value={value.illustCount}
            onChange={(illustCount) => onChange({ ...value, illustCount })}
          />
          <p className="text-xs text-slate-400">
            넣을 문구와 그림 설명은 맨 위{" "}
            <span className="font-medium text-slate-500">1. 넣을 문구·그림</span> 칸에 사진 촬영 전에
            적어두시면, 시공 후 사진에 그대로 그려집니다.
          </p>
        </>
      )}
    </div>
  );
}
