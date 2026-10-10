import { Check, Thermometer, X } from "lucide-react";
import type { SiteConditions, SubstrateChecklist } from "@/types";

const CHECKLIST_ITEMS: { key: keyof SubstrateChecklist; label: string }[] = [
  { key: "dust_removed", label: "먼지·기름기·오염 제거" },
  { key: "no_unevenness", label: "요철·단차·균열 없음" },
  { key: "surface_dry", label: "표면 건조 확인" },
  { key: "primer_applied", label: "프라이머 보강(필요 시)" },
  { key: "temperature_ok", label: "시공 적정 온도(15~25℃)" },
];

/** 시공 전 바탕면 점검을 고객에게도 보여주는 읽기 전용 요약 — SiteConditionsCard(사장님
 *  입력용)와 달리 체크·저장 UI 없이 결과만 나열한다. "대충 바르지 않았다"는 신뢰를
 *  고객에게 직접 전달하는 영업 자료 역할이다. */
export default function ProposalSiteConditionsSummary({ conditions }: { conditions: SiteConditions }) {
  return (
    <div className="mb-8 rounded-2xl border border-[#eef0f2] px-4 py-4">
      <p className="mb-3 text-[13px] font-bold text-[#191f28]">시공 전 바탕면 점검</p>
      {conditions.temperature_c !== null && (
        <div className="mb-3 flex items-center gap-1.5 text-[12.5px] text-[#6b7684]">
          <Thermometer className="h-3.5 w-3.5" />
          현장 온도 {conditions.temperature_c}℃
        </div>
      )}
      <ul className="space-y-1.5">
        {CHECKLIST_ITEMS.map(({ key, label }) => {
          const ok = conditions.checklist[key];
          return (
            <li key={key} className="flex items-center gap-2 text-[12.5px]">
              {ok ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              )}
              <span className={ok ? "text-[#191f28]" : "text-slate-400"}>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
