"use client";

import type { FaucetType, SinkOptions, SinkSpec } from "@/types";
import { FormSection, OptionCard } from "@/components/ui/FormControls";

const SPEC_OPTIONS: { id: SinkSpec; label: string; sublabel: string }[] = [
  { id: "standard_850", label: "기본형 850", sublabel: "일반 규격" },
  { id: "standard_860", label: "기본형 860", sublabel: "일반 규격" },
  { id: "premium_square", label: "고급 사각", sublabel: "프리미엄" },
];

const FAUCET_OPTIONS: { id: FaucetType; label: string }[] = [
  { id: "none", label: "교체 없음" },
  { id: "waterfall", label: "폭포 수전" },
  { id: "gooseneck", label: "거위목 수전" },
];

interface Props {
  value: SinkOptions;
  onChange: (value: SinkOptions) => void;
}

export default function SinkForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <FormSection title="싱크볼 타공 규격">
        <div className="grid grid-cols-3 gap-2">
          {SPEC_OPTIONS.map((opt) => (
            <OptionCard
              key={opt.id}
              label={opt.label}
              sublabel={opt.sublabel}
              selected={value.spec === opt.id}
              onClick={() => onChange({ ...value, spec: opt.id })}
            />
          ))}
        </div>
      </FormSection>

      <FormSection title="수전 교체">
        <div className="grid grid-cols-3 gap-2">
          {FAUCET_OPTIONS.map((opt) => (
            <OptionCard
              key={opt.id}
              label={opt.label}
              selected={value.faucetType === opt.id}
              onClick={() => onChange({ ...value, faucetType: opt.id })}
            />
          ))}
        </div>
      </FormSection>

      <FormSection title="배수구 타입">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
          스텐 배수구 세트 (기본 포함)
        </div>
      </FormSection>
    </div>
  );
}
