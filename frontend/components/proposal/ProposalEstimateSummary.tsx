import type { EstimateBreakdown } from "@/types";

function won(amount: number): string {
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

/** 고객 공유용 정밀 견적서 요약 — PremiumReceipt(사장님 서명용 화면, 숨은 트리거 포함)를
 *  그대로 가져다 쓰면 공개 페이지에 owner 전용 상호작용까지 노출될 위험이 있어, 항목별
 *  소계와 총액만 보여주는 읽기 전용 버전을 따로 둔다. */
export default function ProposalEstimateSummary({ estimate }: { estimate: EstimateBreakdown }) {
  return (
    <div className="mb-8 rounded-2xl border border-[#eef0f2] px-4 py-4">
      <p className="mb-3 text-[13px] font-bold text-[#191f28]">정밀 견적서</p>
      <div className="space-y-2">
        {estimate.line_items.map((item) => (
          <div key={item.item_id} className="flex items-center justify-between text-[13px]">
            <span className="text-[#6b7684]">{item.item_name}</span>
            <span className="font-semibold tabular-nums text-[#191f28]">{won(item.subtotal)}</span>
          </div>
        ))}
      </div>
      {estimate.min_callout_applied && estimate.min_callout_note && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-700">
          {estimate.min_callout_note}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-[#eef0f2] pt-3">
        <span className="text-[14px] font-bold text-[#191f28]">합계(VAT 포함)</span>
        <span className="text-[18px] font-extrabold tabular-nums text-indigo-600">{won(estimate.total_cost)}</span>
      </div>
      {estimate.deposit && (
        <p className="mt-2 text-[11.5px] text-[#8b95a1]">
          계약금 {estimate.deposit.rate_percent}% · {won(estimate.deposit.amount)} — {estimate.deposit.note}
        </p>
      )}
    </div>
  );
}
