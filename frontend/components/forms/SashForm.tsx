"use client";

import type { SashOptions } from "@/types";
import { FormSection, NumberField, ToggleRow } from "@/components/ui/FormControls";
import PanelArrayField from "@/components/ui/PanelArrayField";
import SwatchPicker from "@/components/ui/SwatchPicker";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";

interface Props {
  value: SashOptions;
  onChange: (value: SashOptions) => void;
}

export default function SashForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <FormSection title="컬러/패턴">
        <SwatchPicker
          swatches={ALL_PATTERN_SWATCHES}
          selectedId={value.patternId}
          onSelect={(patternId) => onChange({ ...value, patternId })}
        />
      </FormSection>

      <NumberField
        label="필름 자재 단가 (원/m · 장폭 1.22m 기준)"
        unit="원"
        step={500}
        value={value.unitPricePerM}
        onChange={(unitPricePerM) => onChange({ ...value, unitPricePerM })}
      />

      <FormSection title="창틀 규격" description="창틀 바깥 치수를 가로×세로로 입력하세요">
        <PanelArrayField
          items={value.frames}
          onChange={(frames) => onChange({ ...value, frames })}
          addLabel="창틀 추가"
        />
      </FormSection>

      <ToggleRow
        label="프라이머 밑작업"
        description="기존 도장면/오염면 위 시공인 경우 접착력 확보를 위해 필요"
        checked={value.needsPrimer}
        onChange={(needsPrimer) => onChange({ ...value, needsPrimer })}
      />
    </div>
  );
}
