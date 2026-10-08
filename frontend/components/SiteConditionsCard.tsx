"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, Thermometer } from "lucide-react";
import { saveSiteConditions } from "@/lib/api";
import type { SiteConditions, SubstrateChecklist } from "@/types";

const CHECKLIST_ITEMS: { key: keyof SubstrateChecklist; label: string }[] = [
  { key: "dust_removed", label: "먼지·기름기·오염 제거" },
  { key: "no_unevenness", label: "요철·단차·균열 없음(있으면 퍼티로 평탄화)" },
  { key: "surface_dry", label: "표면 건조 확인(물기 없음)" },
  { key: "primer_applied", label: "약한 바탕재(석고보드 등)는 프라이머 보강" },
  { key: "temperature_ok", label: "시공 적정 온도(15~25℃) 확인" },
];

const MIN_TEMP = 15;
const MAX_TEMP = 25;

const EMPTY_CHECKLIST: SubstrateChecklist = {
  dust_removed: false,
  no_unevenness: false,
  surface_dry: false,
  primer_applied: false,
  temperature_ok: false,
};

interface Props {
  jobId: string;
  initial?: SiteConditions | null;
}

/** 시공 전 현장 조건(온도·하지 점검) 기록 카드.
 *
 *  일본 내장재 시공 업계의 표준 관행(3M 다이노크 시공 매뉴얼 등)을 따른다 —
 *  필름 들뜸·기포·박리 하자의 가장 흔한 원인이 (1) 하지 처리 미흡과 (2) 부적정
 *  온도(15~25℃ 범위 밖에서는 필름이 굳어 모서리 처리가 어려워진다)라, 체크리스트로
 *  남겨두면 하자 원인 추적과 교육 양쪽에 쓸 수 있다. 서명과 달리 작업 중 몇 번이든
 *  다시 저장할 수 있다(법적 합의가 아니라 작업 기록이라서). */
export default function SiteConditionsCard({ jobId, initial }: Props) {
  const [temperature, setTemperature] = useState(initial?.temperature_c?.toString() ?? "");
  const [checklist, setChecklist] = useState<SubstrateChecklist>(initial?.checklist ?? EMPTY_CHECKLIST);
  const [recordedAt, setRecordedAt] = useState(initial?.recorded_at ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tempNum = temperature === "" ? null : Number(temperature);
  const tempOutOfRange = tempNum !== null && !Number.isNaN(tempNum) && (tempNum < MIN_TEMP || tempNum > MAX_TEMP);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveSiteConditions(jobId, tempNum, checklist);
      setRecordedAt(updated.site_conditions?.recorded_at ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
        <Thermometer className="h-4 w-4 text-indigo-600" />
        시공 현장 조건 점검
      </p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
        필름 들뜸·기포 하자는 대부분 하지 처리 미흡이나 부적정 온도에서 생깁니다
      </p>

      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-[13px] font-medium text-slate-600">현장 온도</span>
        <input
          type="number"
          inputMode="decimal"
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
          placeholder="예: 18"
          className="h-10 w-20 rounded-lg border border-slate-200 px-2 text-center text-[14px] tabular-nums outline-none focus:border-indigo-500"
        />
        <span className="text-[13px] text-slate-400">℃</span>
      </div>
      {tempOutOfRange && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] font-medium text-amber-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          적정 범위({MIN_TEMP}~{MAX_TEMP}℃) 밖이에요. 낮으면 필름이 굳어 모서리 처리가 어려우니 히트건으로 가열해 주세요.
        </p>
      )}

      <div className="mt-3 space-y-2">
        {CHECKLIST_ITEMS.map((item) => (
          <label key={item.key} className="flex items-center gap-2.5 text-[13px] text-slate-700">
            <input
              type="checkbox"
              checked={checklist[item.key]}
              onChange={(e) => setChecklist((prev) => ({ ...prev, [item.key]: e.target.checked }))}
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            {item.label}
          </label>
        ))}
      </div>

      {error && <p className="mt-2 text-[12px] font-medium text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-100 text-[13px] font-semibold text-slate-700 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        {saving ? "저장 중..." : "기록 저장"}
      </button>
      {recordedAt && !saving && (
        <p className="mt-1.5 text-center text-[11px] text-slate-400">
          마지막 저장: {new Date(recordedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}
