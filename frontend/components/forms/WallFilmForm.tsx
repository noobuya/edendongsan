"use client";

import type { WallFilmOptions } from "@/types";
import { FormSection, NumberField, ToggleRow } from "@/components/ui/FormControls";
import PanelArrayField from "@/components/ui/PanelArrayField";
import SwatchPicker from "@/components/ui/SwatchPicker";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";

interface Props {
  value: WallFilmOptions;
  onChange: (value: WallFilmOptions) => void;
}

/** 벽면 시트지 입력.
 *
 *  벽은 한 면씩 가로×세로로 받는다. 방 전체를 한 칸에 뭉뚱그리면 문·창 빼는 계산을
 *  사장님이 암산해야 해서, 면 단위로 넣고 개수로 곱하는 편이 현장에서 빠르다. */
export default function WallFilmForm({ value, onChange }: Props) {
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

      <FormSection title="벽 면적" description="한 면씩 가로×높이를 입력하세요 (천장고는 보통 2400mm)">
        <PanelArrayField
          items={value.walls}
          onChange={(walls) => onChange({ ...value, walls })}
          countLabel="면 수"
          addLabel="벽 직접 입력"
          presets={[
            { label: "벽 한 면", widthMm: 4000, heightMm: 2400 },
            { label: "긴 벽", widthMm: 6000, heightMm: 2400 },
            { label: "주방 벽", widthMm: 3000, heightMm: 1400 },
          ]}
        />
      </FormSection>

      <ToggleRow
        label="면처리(프라이머)"
        description="벽지 위에 그냥 붙이면 들뜹니다. 벽지를 뜯어내고 붙이는 경우가 아니면 켜두세요"
        checked={value.needsPrimer}
        onChange={(needsPrimer) => onChange({ ...value, needsPrimer })}
      />
    </div>
  );
}
