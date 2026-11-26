"use client";

import type { FilmOptions } from "@/types";
import { FormSection, NumberField, ToggleRow } from "@/components/ui/FormControls";
import { Palette } from "lucide-react";
import PanelArrayField from "@/components/ui/PanelArrayField";
import SwatchPicker from "@/components/ui/SwatchPicker";
import SwatchPhotoField from "@/components/ui/SwatchPhotoField";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";

interface Props {
  value: FilmOptions;
  onChange: (value: FilmOptions) => void;
}

const GROUPS = ["cabinets", "doors", "molding", "storage"] as const;

export default function FilmForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <FormSection title="컬러/패턴">
        <SwatchPhotoField
          value={value.swatchImageDataUrl}
          onChange={(swatchImageDataUrl) => onChange({ ...value, swatchImageDataUrl })}
        />
        {/* 견본 사진이 있으면 색상 칩을 아예 숨긴다 — 흐리게만 남겨두면 "이것도
            골라야 하나" 헷갈려했다. 적용되는 건 사진이라 더 고를 게 없다. */}
        {!value.swatchImageDataUrl && (
          <div className="mt-3">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              또는 색상 칩에서 고르기
            </span>
            <SwatchPicker
              swatches={ALL_PATTERN_SWATCHES}
              selectedId={value.patternId}
              onSelect={(patternId) => onChange({ ...value, patternId })}
            />
          </div>
        )}
      </FormSection>

      <NumberField
        label="필름 자재 단가 (원/m · 장폭 1.22m 기준)"
        unit="원"
        step={500}
        value={value.unitPricePerM}
        onChange={(unitPricePerM) => onChange({ ...value, unitPricePerM })}
      />

      <Accordion type="multiple" defaultValue={[...GROUPS]} className="space-y-2.5">
        <AccordionItem value="cabinets">
          <AccordionTrigger>
            <span className="text-sm font-semibold text-slate-700">싱크대장</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <FormSection title="상부장">
              <PanelArrayField
                items={value.upperCabinets}
                onChange={(upperCabinets) => onChange({ ...value, upperCabinets })}
                addLabel="상부장 추가"
              />
            </FormSection>
            <FormSection title="하부장">
              <PanelArrayField
                items={value.lowerCabinets}
                onChange={(lowerCabinets) => onChange({ ...value, lowerCabinets })}
                addLabel="하부장 추가"
              />
            </FormSection>

            {/* [투톤 주방 — 2026-11-26] "상부장은 화이트, 하부장은 우드"처럼 고객이
                상/하부장 색상을 다르게 원할 때만 켠다. 끄면 하부장도 위 "컬러/패턴"
                견본책을 그대로 같이 쓴다(견적서 원단도 한 줄로 합쳐 계산). */}
            <ToggleRow
              label="하부장 색상을 다르게"
              description="상부장과 다른 견본책을 쓰는 투톤 주방일 때만 켜세요"
              checked={value.lowerCabinetsPatternId != null}
              onChange={(on) =>
                onChange({
                  ...value,
                  lowerCabinetsPatternId: on ? value.lowerCabinetsPatternId ?? value.patternId : undefined,
                  lowerCabinetsUnitPricePerM: on ? value.lowerCabinetsUnitPricePerM : undefined,
                })
              }
            />
            {value.lowerCabinetsPatternId != null && (
              <FormSection title="하부장 전용 컬러/패턴">
                <div className="mb-2 flex items-center gap-1.5 text-[12px] text-slate-500">
                  <Palette className="h-3.5 w-3.5" />
                  하부장만 이 견본책으로 따로 계산해 견적서에 별도 원단 줄로 뽑아요
                </div>
                <SwatchPicker
                  swatches={ALL_PATTERN_SWATCHES}
                  selectedId={value.lowerCabinetsPatternId}
                  onSelect={(lowerCabinetsPatternId) => onChange({ ...value, lowerCabinetsPatternId })}
                />
                <NumberField
                  label="하부장 필름 자재 단가 (원/m)"
                  unit="원"
                  step={500}
                  value={value.lowerCabinetsUnitPricePerM ?? value.unitPricePerM}
                  onChange={(lowerCabinetsUnitPricePerM) => onChange({ ...value, lowerCabinetsUnitPricePerM })}
                />
              </FormSection>
            )}

            <FormSection title="아일랜드 식탁">
              <PanelArrayField
                items={value.islandTables}
                onChange={(islandTables) => onChange({ ...value, islandTables })}
                addLabel="아일랜드 식탁 추가"
              />
            </FormSection>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="doors">
          <AccordionTrigger>
            <span className="text-sm font-semibold text-slate-700">방문 및 문틀</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <FormSection title="방문">
              <PanelArrayField
                items={value.doors}
                onChange={(doors) => onChange({ ...value, doors })}
                addLabel="방문 추가"
                showDoorType
              />
            </FormSection>
            <FormSection title="문틀">
              <PanelArrayField
                items={value.doorframes}
                onChange={(doorframes) => onChange({ ...value, doorframes })}
                addLabel="문틀 추가"
              />
            </FormSection>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="molding">
          <AccordionTrigger>
            <span className="text-sm font-semibold text-slate-700">걸레받이/몰딩</span>
          </AccordionTrigger>
          <AccordionContent>
            <NumberField
              label="총 길이"
              unit="m"
              step={0.5}
              value={value.moldingLengthM}
              onChange={(moldingLengthM) => onChange({ ...value, moldingLengthM })}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="storage">
          <AccordionTrigger>
            <span className="text-sm font-semibold text-slate-700">각종 장식장</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <FormSection title="냉장고장">
              <PanelArrayField
                items={value.fridgeCabinets}
                onChange={(fridgeCabinets) => onChange({ ...value, fridgeCabinets })}
                addLabel="냉장고장 추가"
              />
            </FormSection>
            <FormSection title="펜트리장">
              <PanelArrayField
                items={value.pantryCabinets}
                onChange={(pantryCabinets) => onChange({ ...value, pantryCabinets })}
                addLabel="펜트리장 추가"
              />
            </FormSection>
            <FormSection title="신발장">
              <PanelArrayField
                items={value.shoeCabinets}
                onChange={(shoeCabinets) => onChange({ ...value, shoeCabinets })}
                addLabel="신발장 추가"
              />
            </FormSection>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <ToggleRow
        label="프라이머 밑작업"
        description="기존 벽지/오염면 위 시공인 경우 접착력 확보를 위해 필요"
        checked={value.needsPrimer}
        onChange={(needsPrimer) => onChange({ ...value, needsPrimer })}
      />
    </div>
  );
}
