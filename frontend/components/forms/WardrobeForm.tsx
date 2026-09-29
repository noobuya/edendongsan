"use client";

import type { WardrobeOptions } from "@/types";
import { FormSection, NumberField, ToggleRow } from "@/components/ui/FormControls";
import PanelArrayField from "@/components/ui/PanelArrayField";
import SwatchPicker from "@/components/ui/SwatchPicker";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";

interface Props {
  value: WardrobeOptions;
  onChange: (value: WardrobeOptions) => void;
}

/** 장롱/옷장 필름 시공 입력.
 *
 *  문짝과 몸통을 따로 받는 이유는 품 기준이 두 배 가까이 다르기 때문이다 — 문짝은
 *  떼어내 눕혀 붙일 수 있어 1품에 14㎡지만, 몸통(측판·천판)은 세워둔 채 좁은 틈에서
 *  작업해 7㎡밖에 못 한다. 붙박이장이 많은 현장일수록 차이가 크게 벌어진다. */
export default function WardrobeForm({ value, onChange }: Props) {
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

      <FormSection title="옷장 문짝" description="문짝 한 짝의 가로×세로 치수를 입력하세요">
        <PanelArrayField
          items={value.doors}
          onChange={(doors) => onChange({ ...value, doors })}
          addLabel="문짝 추가"
          showDoorType
        />
      </FormSection>

      <FormSection title="옷장 몸통" description="측판·천판 등 노출되는 면을 입력하세요">
        <PanelArrayField
          items={value.bodies}
          onChange={(bodies) => onChange({ ...value, bodies })}
          addLabel="몸통 추가"
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
