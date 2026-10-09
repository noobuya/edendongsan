"use client";

import type { DoorFrameOptions } from "@/types";
import { FormSection, NumberField, ToggleRow } from "@/components/ui/FormControls";
import PanelArrayField from "@/components/ui/PanelArrayField";
import SwatchPicker from "@/components/ui/SwatchPicker";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";

interface Props {
  value: DoorFrameOptions;
  onChange: (value: DoorFrameOptions) => void;
}

/** 문짝/문틀 시공 입력.
 *
 *  문짝과 문틀을 따로 받는 이유는 품(인건비) 기준이 다르기 때문이다 — 문짝은 평평해
 *  1품에 12㎡를 붙이지만, 문틀은 모서리와 홈이 많아 8㎡밖에 못 한다. 한 칸에 몰아
 *  받으면 문틀이 많은 현장에서 인건비가 실제보다 적게 잡힌다. */
export default function DoorFrameForm({ value, onChange }: Props) {
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

      <FormSection title="문짝 규격" description="문짝 한 면의 가로×세로 치수를 입력하세요">
        <PanelArrayField
          items={value.doors}
          onChange={(doors) => onChange({ ...value, doors })}
          addLabel="문짝 직접 입력"
          showDoorType
          presets={[
            { label: "방문", widthMm: 900, heightMm: 2100 },
            { label: "중문", widthMm: 800, heightMm: 2050 },
            { label: "현관문", widthMm: 1000, heightMm: 2100 },
          ]}
        />
      </FormSection>

      <FormSection title="문틀 규격" description="문틀은 펼쳐서 잰 전체 길이 × 감는 폭입니다 (세로 2100 + 가로 900 ≈ 2600mm)">
        <PanelArrayField
          items={value.doorframes}
          onChange={(doorframes) => onChange({ ...value, doorframes })}
          addLabel="문틀 직접 입력"
          presets={[
            { label: "방문 문틀", widthMm: 2600, heightMm: 300 },
            { label: "현관 문틀", widthMm: 2800, heightMm: 350 },
          ]}
        />
      </FormSection>

      <ToggleRow
        label="프라이머 밑작업"
        description="기존 도장면/오염면 위 시공인 경우 접착력 확보를 위해 필요"
        checked={value.needsPrimer}
        onChange={(needsPrimer) => onChange({ ...value, needsPrimer })}
      />

      <ToggleRow
        label="기존 실리콘 제거 및 재시공"
        description="기본가에 포함되지 않는 별도 청구 항목입니다"
        checked={value.siliconeRecoat}
        onChange={(siliconeRecoat) => onChange({ ...value, siliconeRecoat })}
      />

      <FormSection
        title="현관 방화문"
        description="스틸 규격 문이라 ㎡ 계산 없이 단면/양면 시공 짝수로 받습니다"
      >
        <div className="flex gap-4">
          <NumberField
            label="단면 시공"
            unit="짝"
            value={value.fireDoors.find((d) => d.sides === "single")?.count ?? 0}
            onChange={(count) => {
              const rest = value.fireDoors.filter((d) => d.sides !== "single");
              onChange({ ...value, fireDoors: count > 0 ? [...rest, { sides: "single", count }] : rest });
            }}
          />
          <NumberField
            label="양면 시공"
            unit="짝"
            value={value.fireDoors.find((d) => d.sides === "double")?.count ?? 0}
            onChange={(count) => {
              const rest = value.fireDoors.filter((d) => d.sides !== "double");
              onChange({ ...value, fireDoors: count > 0 ? [...rest, { sides: "double", count }] : rest });
            }}
          />
        </div>
      </FormSection>
    </div>
  );
}
