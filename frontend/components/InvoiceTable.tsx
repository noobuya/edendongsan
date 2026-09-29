"use client";

import { Fragment, useState } from "react";
import { Download, MessageCircleMore } from "lucide-react";
import BusinessBadge from "@/components/BusinessBanner";
import type { DetailCategory, EstimateBreakdown, LineItem, LineItemDetail } from "@/types";

function won(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

function formatQty(q: number): string {
  if (Number.isInteger(q)) return q.toString();
  return q.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

interface FlatRow extends LineItemDetail {
  itemName: string;
}

function flatten(lineItems: LineItem[], category: DetailCategory): FlatRow[] {
  return lineItems.flatMap((li) =>
    li.details.filter((d) => d.category === category).map((d) => ({ ...d, itemName: li.item_name }))
  );
}

function CategorySection({ title, rows, total }: { title: string; rows: FlatRow[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <Fragment>
      <tr className="border-t border-slate-100 bg-slate-50">
        <td colSpan={5} className="px-5 py-2 text-xs font-bold tracking-wide text-slate-500">
          {title}
        </td>
      </tr>
      {rows.map((d, idx) => (
        <tr key={idx} className="border-b border-slate-50 text-slate-600">
          <td className="px-5 py-2 pl-6">
            <div className="font-medium text-slate-700">{d.label}</div>
            <div className="text-[10px] text-slate-400">{d.itemName}</div>
          </td>
          <td className="px-3 py-2 text-slate-400">{d.spec || "-"}</td>
          <td className="px-3 py-2 text-right tabular-nums">
            {formatQty(d.quantity)}
            {d.unit}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">{won(d.unit_price)}</td>
          <td className="px-5 py-2 text-right tabular-nums font-medium text-slate-800">{won(d.amount)}</td>
        </tr>
      ))}
      <tr className="border-b border-slate-100 bg-slate-50/60">
        <td colSpan={4} className="px-5 py-1.5 text-right text-xs text-slate-400">
          {title} 소계
        </td>
        <td className="px-5 py-1.5 text-right text-xs font-semibold text-slate-600">{won(total)}</td>
      </tr>
    </Fragment>
  );
}

export default function InvoiceTable({
  estimate,
  onSecretHold,
}: {
  estimate: EstimateBreakdown;
  /** 상호 뱃지를 3초 길게 눌렀을 때 — 단가 설정(개발자 모드)을 연다. */
  onSecretHold?: () => void;
}) {
  const [printNotice, setPrintNotice] = useState<string | null>(null);

  /** [폰에서는 window.print()가 아무 일도 하지 않는다]
   *  안드로이드 WebView는 인쇄 대화상자를 띄우지 않아서, 버튼을 눌러도 반응이 없는
   *  것처럼 보인다(고장난 줄 알기 딱 좋다). 눌리지 않는 게 아니라 그 기능이 없는
   *  것이므로, 아무 말 없이 삼키지 말고 무엇을 해야 하는지 알려준다. */
  function handlePrint() {
    const isNative =
      typeof window !== "undefined" &&
      Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
        ?.isNativePlatform?.());
    if (isNative) {
      setPrintNotice(
        "휴대폰 앱에서는 인쇄가 지원되지 않습니다. 카카오톡으로 견적서를 보내거나, PC 브라우저에서 같은 견적서를 열어 PDF로 저장해주세요."
      );
      return;
    }
    window.print();
  }

  const [shareHint, setShareHint] = useState(false);

  return (
    <div className="overflow-hidden glass-panel">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">전자 견적서</h3>
          <p className="mt-0.5 text-xs text-slate-400">AI 인식 면적 · 천장 {estimate.ceiling_area_m2}㎡</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            title="PDF 다운로드"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition-transform active:scale-95"
          >
            <Download className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShareHint(true);
                setTimeout(() => setShareHint(false), 2000);
              }}
              title="카카오톡 공유"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FEE500] text-[#3C1E1E] transition-transform active:scale-95"
            >
              <MessageCircleMore className="h-4 w-4" />
            </button>
            {shareHint && (
              <div className="absolute right-0 top-11 z-10 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
                준비 중인 기능입니다
              </div>
            )}
          </div>
        </div>
      </div>

      {printNotice && (
        <p className="mx-3.5 mb-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
          {printNotice}
        </p>
      )}

      <div className="grid grid-cols-3 gap-px border-b border-slate-100 bg-slate-100">
        <div className="bg-white px-4 py-3 text-center">
          <p className="text-[11px] text-slate-400">자재비</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800">{won(estimate.material_total)}</p>
        </div>
        <div className="bg-white px-4 py-3 text-center">
          <p className="text-[11px] text-slate-400">인건비(시공비)</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800">{won(estimate.labor_total)}</p>
        </div>
        <div className="bg-white px-4 py-3 text-center">
          <p className="text-[11px] text-slate-400">부자재/경비</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800">{won(estimate.expense_total)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs text-slate-400">
              <th className="px-5 py-2.5 text-left font-medium">품목</th>
              <th className="px-3 py-2.5 text-left font-medium">규격</th>
              <th className="px-3 py-2.5 text-right font-medium">수량</th>
              <th className="px-3 py-2.5 text-right font-medium">단가</th>
              <th className="px-5 py-2.5 text-right font-medium">금액</th>
            </tr>
          </thead>
          <tbody>
            <CategorySection title="자재 내역" rows={flatten(estimate.line_items, "material")} total={estimate.material_total} />
            <CategorySection
              title="인건비 (시공비)"
              rows={flatten(estimate.line_items, "labor")}
              total={estimate.labor_total}
            />
            <CategorySection
              title="부자재 / 경비"
              rows={flatten(estimate.line_items, "expense")}
              total={estimate.expense_total}
            />
          </tbody>
        </table>
      </div>

      <div className="space-y-1.5 border-t border-slate-100 px-5 py-4">
        <div className="flex justify-between text-sm text-slate-500">
          <span>공급가액</span>
          <span className="tabular-nums">{won(estimate.supply_amount)}</span>
        </div>
        <div className="flex justify-between text-sm text-slate-500">
          <span>부가세 (10%)</span>
          <span className="tabular-nums">{won(estimate.vat)}</span>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 px-5 py-4 shadow-lg shadow-indigo-600/25">
          <span className="text-sm font-semibold text-indigo-100">총 예상 견적 금액</span>
          <span className="text-2xl font-extrabold tabular-nums text-white">{won(estimate.total_cost)}</span>
        </div>
      </div>

      {/* 업체 표기는 견적서 안에 둔다. 화면에 떠 있으면 마스킹·스크롤을 가리는데,
          견적서 안에서는 오히려 "누가 낸 견적인지" 밝히는 공식 문서의 일부가 된다.
          (3초 길게 누르면 단가 설정이 열리는 것도 그대로다.) */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3.5 py-3">
        <BusinessBadge onSecretHold={onSecretHold} />
        <span className="text-[10px] leading-tight text-slate-400">
          본 견적서는 현장 실측 결과에 따라
          <br />
          조정될 수 있습니다
        </span>
      </div>

    </div>
  );
}
