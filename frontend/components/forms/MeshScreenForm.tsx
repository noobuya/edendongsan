"use client";

import type { MeshScreenOptions, MeshType } from "@/types";
import { FormSection, OptionCard, ToggleRow } from "@/components/ui/FormControls";
import PanelArrayField from "@/components/ui/PanelArrayField";

interface Props {
  value: MeshScreenOptions;
  onChange: (value: MeshScreenOptions) => void;
}

const MESH_CHOICES: { id: MeshType; label: string; sub: string }[] = [
  { id: "fine_20", label: "미세 (20메시)", sub: "일반 방충망보다 촘촘" },
  { id: "ultra_30", label: "초미세 (30메시)", sub: "작은 날벌레까지 차단" },
  { id: "pet_proof", label: "펫 방충망", sub: "강아지·고양이 발톱에 견딤" },
];

/** 미세방충망 교체 입력.
 *
 *  창 크기를 받는 이유는 원단이 ㎡ 단위로 나가기 때문이고, 짝수를 따로 받는 이유는
 *  틀을 새로 짤 때 짝당 비용이 붙기 때문이다. 기존 틀이 멀쩡하면 원단만 갈아 끼운다. */
export default function MeshScreenForm({ value, onChange }: Props) {
  return (
    <div className="space-y-5">
      <FormSection title="방충망 종류">
        <div className="grid grid-cols-1 gap-2">
          {MESH_CHOICES.map((c) => (
            <OptionCard
              key={c.id}
              label={c.label}
              sublabel={c.sub}
              selected={value.meshType === c.id}
              onClick={() => onChange({ ...value, meshType: c.id })}
            />
          ))}
        </div>
      </FormSection>

      <FormSection title="창 규격" description="방충망이 들어갈 창의 가로×세로와 짝수를 입력하세요">
        <PanelArrayField
          items={value.screens}
          onChange={(screens) => onChange({ ...value, screens })}
          addLabel="창 추가"
        />
      </FormSection>

      <ToggleRow
        label="방충망 틀까지 새로 제작"
        description="기존 틀이 휘었거나 삭았을 때. 틀이 멀쩡하면 원단만 교체합니다"
        checked={value.replaceFrame}
        onChange={(replaceFrame) => onChange({ ...value, replaceFrame })}
      />
    </div>
  );
}
