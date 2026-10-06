"use client";

import type { IllustrationOptions } from "@/types";
import { FormSection, NumberField, TextField } from "@/components/ui/FormControls";

interface Props {
  value: IllustrationOptions;
  onChange: (value: IllustrationOptions) => void;
}

/** 사장님 전용 일러스트. 문구·그림 설명은 사진 촬영 전에 적어두면 시공 후 사진에 그대로 그려진다. */
export default function IllustrationForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <FormSection title="넣을 문구·그림" description="학생 기기에는 나오지 않는 사장님 전용 항목입니다">
        <div className="space-y-4">
          <TextField
            label="문구"
            value={value.text}
            placeholder="DAEHAN INTERIOR FILM"
            onChange={(text) => onChange({ ...value, text })}
          />
          <TextField
            label="그림 설명"
            value={value.description}
            placeholder="얇은 선으로 그린 올리브 나뭇가지를 문구 왼쪽에"
            multiline
            rows={3}
            onChange={(description) => onChange({ ...value, description })}
          />
        </div>
      </FormSection>

      <NumberField
        label="일러스트 시공 건수"
        unit="건"
        value={value.count}
        onChange={(count) => onChange({ ...value, count })}
      />
    </div>
  );
}
