"use client";

import { Wand2 } from "lucide-react";

interface Props {
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  illustText: string;
  onIllustTextChange: (value: string) => void;
  illustDescription: string;
  onIllustDescriptionChange: (value: string) => void;
}

const FIELD =
  "w-full min-w-0 border-0 border-b border-slate-900/10 bg-transparent px-0 pb-3 pt-2 text-[17px] font-light text-slate-900 outline-none transition-colors placeholder:font-light placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0";

/** 1단계 — 현장 등록. 사진은 배경 무대에서 찍으므로, 이 패널은 사람이 적는 정보만 받는다. */
export default function StepSite({
  customerName,
  onCustomerNameChange,
  illustText,
  onIllustTextChange,
  illustDescription,
  onIllustDescriptionChange,
}: Props) {
  return (
    <div className="space-y-9 animate-[step-in_0.35s_ease-out]">
      <div>
        <h2 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">현장 등록</h2>
        <p className="mt-2 text-[14px] font-light text-slate-500">사진을 담고 고객 정보를 적어주세요</p>
      </div>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">고객명</span>
        <input
          type="text"
          value={customerName}
          onChange={(e) => onCustomerNameChange(e.target.value)}
          placeholder="홍길동 고객님"
          className={FIELD}
        />
      </label>

      {/* 상담 순서 그대로 — "어떤 문구를 넣어드릴까요?"를 먼저 여쭤 적어두면
          AI가 시공 후 사진에 그대로 그려 넣는다. */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-indigo-500" />
          <span className="text-[13px] font-semibold tracking-tight text-slate-900">넣을 문구·그림</span>
          <span className="text-[11px] font-light text-slate-400">유리 썬팅·일러스트 시 선택</span>
        </div>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">문구</span>
          <input
            type="text"
            value={illustText}
            onChange={(e) => onIllustTextChange(e.target.value)}
            placeholder="DAEHAN INTERIOR FILM"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">그림 설명</span>
          <textarea
            value={illustDescription}
            onChange={(e) => onIllustDescriptionChange(e.target.value)}
            rows={3}
            placeholder="얇은 선으로 그린 올리브 나뭇가지를 문구 왼쪽에"
            className={`${FIELD} resize-none leading-relaxed`}
          />
        </label>
      </div>
    </div>
  );
}
