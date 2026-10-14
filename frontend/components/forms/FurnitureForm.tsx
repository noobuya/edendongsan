"use client";

import type { FurnitureOptions } from "@/types";
import { FormSection, NumberField, ToggleRow } from "@/components/ui/FormControls";
import SwatchPicker from "@/components/ui/SwatchPicker";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";

interface Props {
  value: FurnitureOptions;
  onChange: (value: FurnitureOptions) => void;
}

/** 의자/책상/책꽂이/서랍장/장식장 필름 시공 입력.
 *
 *  film/wardrobe처럼 가로×세로로 면적을 재지 않는다 — 가구는 규격이 제각각이라
 *  (교회 의자 수십 개를 하나하나 재는 건 현실적이지 않다) 종류별 "개수"만 받고,
 *  견적은 종류별 개당 단가(estimator.py `_furniture_line_item`)로 계산한다. */
export default function FurnitureForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <FormSection title="컬러/패턴">
        <SwatchPicker
          swatches={ALL_PATTERN_SWATCHES}
          selectedId={value.patternId}
          onSelect={(patternId) => onChange({ ...value, patternId })}
        />
      </FormSection>

      <FormSection title="가구 종류별 개수" description="사진에 있는 가구 종류만 입력하세요">
        <div className="space-y-3">
          <NumberField
            label="의자"
            unit="개"
            value={value.chairs}
            onChange={(chairs) => onChange({ ...value, chairs })}
          />
          <NumberField
            label="책상"
            unit="개"
            value={value.desks}
            onChange={(desks) => onChange({ ...value, desks })}
          />
          <NumberField
            label="책꽂이"
            unit="개"
            value={value.bookshelves}
            onChange={(bookshelves) => onChange({ ...value, bookshelves })}
          />
          <NumberField
            label="서랍장"
            unit="개"
            value={value.drawerCabinets}
            onChange={(drawerCabinets) => onChange({ ...value, drawerCabinets })}
          />
          <NumberField
            label="장식장"
            unit="개"
            value={value.displayCabinets}
            onChange={(displayCabinets) => onChange({ ...value, displayCabinets })}
          />
        </div>
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
