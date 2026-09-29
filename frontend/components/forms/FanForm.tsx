"use client";

import type { CeilingMaterial, FanOptions } from "@/types";
import { FormSection, NumberField, OptionCard } from "@/components/ui/FormControls";
import SwatchPicker from "@/components/ui/SwatchPicker";
import { PATTERN_SWATCHES } from "@/lib/patternSwatches";

const CEILING_MATERIAL_OPTIONS: { id: CeilingMaterial; label: string }[] = [
  { id: "gypsum", label: "석고보드" },
  { id: "concrete", label: "콘크리트" },
  { id: "wood_reinforced", label: "목공 보강" },
];

interface Props {
  value: FanOptions;
  onChange: (value: FanOptions) => void;
}

export default function FanForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <NumberField
        label="설치 대수"
        unit="대"
        value={value.fanCount}
        onChange={(fanCount) => onChange({ ...value, fanCount })}
      />

      <FormSection title="날개 색상">
        <SwatchPicker
          swatches={PATTERN_SWATCHES}
          selectedId={value.fanColor}
          onSelect={(fanColor) => onChange({ ...value, fanColor })}
        />
      </FormSection>

      <FormSection title="천장 보강 재질">
        <div className="grid grid-cols-3 gap-2">
          {CEILING_MATERIAL_OPTIONS.map((opt) => (
            <OptionCard
              key={opt.id}
              label={opt.label}
              selected={value.ceilingMaterial === opt.id}
              onClick={() => onChange({ ...value, ceilingMaterial: opt.id })}
            />
          ))}
        </div>
      </FormSection>

      <NumberField
        label="보강 면적"
        unit="㎡"
        step={0.1}
        value={value.reinforcementAreaM2}
        onChange={(reinforcementAreaM2) => onChange({ ...value, reinforcementAreaM2 })}
      />

      <NumberField
        label="층고 높이"
        unit="m"
        step={0.1}
        value={value.ceilingHeightM}
        onChange={(ceilingHeightM) => onChange({ ...value, ceilingHeightM })}
      />
    </div>
  );
}
