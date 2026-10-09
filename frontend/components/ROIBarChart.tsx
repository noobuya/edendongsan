import { BadgePercent, Clock, VolumeX } from "lucide-react";
import type { RoiComparison } from "@/types";

function won(amount: number): string {
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

// 소구포인트 칩마다 다른 아이콘을 붙인다 — highlights 배열은 "비용 N% 절감" ·
// "공기 단축 (...)" · "소음·분진 없음" 순으로 항상 고정돼 있다(estimator.py의
// _roi_comparison/_roi_comparison_from_breakdown 참고). 순서가 바뀌어도 아이콘이
// 안 맞아 보이는 것뿐 글자는 그대로 나오므로 안전하게 index로 매핑한다.
const HIGHLIGHT_ICONS = [BadgePercent, Clock, VolumeX];

/** 견적서 하단 영업 리포트 — "전체 교체 vs 필름 리폼" 비용을 막대그래프로 비교하고,
 *  절감률·공사 기간·무소음 세 가지 소구포인트를 칩으로 강조한다. 새 차트 라이브러리를
 *  쓰지 않고 막대 너비를 %로 직접 계산해 그린다(의존성 추가 없이 충분히 단순한 비교). */
export default function ROIBarChart({ roi }: { roi: RoiComparison }) {
  const maxCost = Math.max(roi.replacement_cost, roi.film_cost, 1);
  const replacementPercent = (roi.replacement_cost / maxCost) * 100;
  const filmPercent = (roi.film_cost / maxCost) * 100;

  return (
    <div className="mt-5 rounded-2xl border border-[#eef0f2] px-4 py-4">
      <p className="text-[13px] font-bold text-[#191f28]">{roi.item_name} — 교체 vs 필름 리폼</p>

      <div className="mt-3 space-y-2.5">
        <div>
          <div className="flex items-baseline justify-between text-[12px] text-[#6b7684]">
            <span>전체 교체</span>
            <span className="font-bold tabular-nums text-[#191f28]">{won(roi.replacement_cost)}</span>
          </div>
          <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-[#f2f4f6]">
            <div className="h-full rounded-full bg-[#c5cad1]" style={{ width: `${replacementPercent}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between text-[12px] text-[#6b7684]">
            <span>필름 리폼</span>
            <span className="font-bold tabular-nums text-indigo-600">{won(roi.film_cost)}</span>
          </div>
          <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-[#f2f4f6]">
            <div className="h-full rounded-full bg-indigo-600" style={{ width: `${filmPercent}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        {roi.highlights.map((text, i) => {
          const Icon = HIGHLIGHT_ICONS[i] ?? BadgePercent;
          return (
            <span
              key={text}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-indigo-50 px-3 py-2 text-[12.5px] font-semibold text-indigo-800"
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              {text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
