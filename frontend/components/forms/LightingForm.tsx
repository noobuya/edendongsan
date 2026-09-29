"use client";

import type { LightingInch, LightingOptions } from "@/types";
import { FormSection, NumberField, OptionCard } from "@/components/ui/FormControls";

const INCH_OPTIONS: { id: LightingInch; label: string }[] = [
  { id: "3", label: "3인치" },
  { id: "4", label: "4인치" },
  { id: "5", label: "5인치" },
];

interface Props {
  value: LightingOptions;
  onChange: (value: LightingOptions) => void;
}

export default function LightingForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <FormSection title="다운라이트 규격">
        <div className="grid grid-cols-3 gap-2">
          {INCH_OPTIONS.map((opt) => (
            <OptionCard
              key={opt.id}
              label={opt.label}
              selected={value.inch === opt.id}
              onClick={() => onChange({ ...value, inch: opt.id })}
            />
          ))}
        </div>
      </FormSection>

      <NumberField
        label="설치 개수"
        unit="개"
        value={value.lightCount}
        onChange={(lightCount) => onChange({ ...value, lightCount })}
      />

      <NumberField
        label="배선 연장 길이"
        unit="m"
        step={0.5}
        value={value.wiringExtensionM}
        onChange={(wiringExtensionM) => onChange({ ...value, wiringExtensionM })}
      />

      <p className="text-xs text-slate-400">
        다운라이트는 천장 타공이 필수이므로, 설치 개수만큼 타공비가 자동으로 포함됩니다.
      </p>
    </div>
  );
}
