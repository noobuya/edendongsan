"use client";

import type { ToiletOptions, ToiletSpec } from "@/types";
import { FormSection, NumberField, OptionCard, ToggleRow } from "@/components/ui/FormControls";

interface Props {
  value: ToiletOptions;
  onChange: (value: ToiletOptions) => void;
}

const TOILET_CHOICES: { id: ToiletSpec; label: string; sub: string }[] = [
  { id: "standard", label: "일반형 투피스", sub: "가장 많이 쓰는 보급형" },
  { id: "one_piece", label: "원피스", sub: "이음매가 없어 청소가 쉬움" },
  { id: "bidet_combo", label: "비데 일체형", sub: "전기·급수 연결 필요" },
];

/** 변기 설치/교체 입력 — 면적이 아니라 대수 기준이다. */
export default function ToiletForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <FormSection title="변기 종류">
        <div className="grid grid-cols-1 gap-2">
          {TOILET_CHOICES.map((c) => (
            <OptionCard
              key={c.id}
              label={c.label}
              sublabel={c.sub}
              selected={value.spec === c.id}
              onClick={() => onChange({ ...value, spec: c.id })}
            />
          ))}
        </div>
      </FormSection>

      <NumberField
        label="설치 대수"
        unit="대"
        value={value.count}
        onChange={(count) => onChange({ ...value, count })}
      />

      <ToggleRow
        label="기존 변기 철거·폐기"
        description="새로 놓는 자리가 아니라 교체라면 켜주세요"
        checked={value.removeExisting}
        onChange={(removeExisting) => onChange({ ...value, removeExisting })}
      />

      <ToggleRow
        label="급수호스·앙카 부속 교체"
        description="오래된 부속은 재사용하면 누수 위험이 큽니다"
        checked={value.replaceSupplyLine}
        onChange={(replaceSupplyLine) => onChange({ ...value, replaceSupplyLine })}
      />
    </div>
  );
}
