"use client";

import { Sparkles } from "lucide-react";

interface Props {
  autoDescription: string;
  onAutoDescriptionChange: (value: string) => void;
}

/** 2단계 — AI에게 더 정확히 어떻게 시공할지 알려주는 화면(선택 사항).
 *
 *  [손으로 영역을 그려 자재를 지정하는 "수동 모드"를 없앴다 — 2026-11]
 *  손그림은 "영역을 못 잡고 엉뚱한 곳에 시공한다"는 신고가 반복됐다. 실제 시공
 *  영역은 이제 항상 사진에서 AI가 자동으로 찾는다(segmentation.py) — 무엇을
 *  시공할지는 위 "시공 항목"(말로 설명하기/직접 선택)에서 정하고, 여기 문구는
 *  "매트 화이트로 해달라" 같은 추가 요청만 보탠다. */
export default function StepMapping({ autoDescription, onAutoDescriptionChange }: Props) {
  return (
    <div className="space-y-5 animate-[step-in_0.35s_ease-out]">
      <div>
        <h2 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">추가 요청사항</h2>
        <p className="mt-2 text-[14px] font-light text-slate-500">더 자세히 전하고 싶은 내용이 있으면 적어주세요 (선택)</p>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            시공 요구사항
          </span>
          <textarea
            value={autoDescription}
            onChange={(e) => onAutoDescriptionChange(e.target.value)}
            rows={5}
            placeholder="예) 상부장과 하부장은 매트 화이트 필름으로 감싸고, 천장에는 실링팬 한 대와 4인치 다운라이트 6개를 달아주세요."
            className="w-full resize-none border-0 border-b border-slate-900/10 bg-transparent px-0 pb-3 pt-2 text-[15px] font-light leading-relaxed text-slate-900 outline-none transition-colors placeholder:font-light placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0"
          />
        </label>
        <p className="flex items-start gap-2 text-[12px] font-light leading-relaxed text-slate-400">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
          AI가 사진에서 시공할 부위를 스스로 찾아 적용합니다. 비워 둬도 됩니다.
        </p>
      </div>
    </div>
  );
}
