"use client";

import type { GlassOptions, GlassTintType } from "@/types";
import { FormSection, OptionCard } from "@/components/ui/FormControls";
import PanelArrayField from "@/components/ui/PanelArrayField";

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
  // 유리 시공은 썬팅만 다룬다. 일러스트는 사장님 전용 "일러스트" 항목으로 분리했다.
  return (
    <div className="space-y-5">
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
    </div>
  );
}
