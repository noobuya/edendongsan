"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Minus, Plus, X } from "lucide-react";
import BrandHero from "@/components/BrandHero";
import CrewSimulator from "@/components/CrewSimulator";
import { PremiumReceiptView, useSecretTrigger, type ReceiptRow } from "@/components/PremiumReceipt";
import PricingSheet from "@/components/PricingSheet";
import QuoteIcon, { toneOfGroup } from "@/components/quote/QuoteIcon";
import {
  calculateEstimator,
  getEstimatorItems,
  getEstimatorPricing,
  saveEstimatorPricing,
  type EstimatorItem,
  type EstimatorResult,
} from "@/lib/api";

// 평수별 전체 견적의 표준 단가(원/평). 현장 실측 후 확정되는 범위 가격이다.
const PYEONG_BASE_MIN = 137_500;
const PYEONG_BASE_MAX = 162_500;
const PYEONG_MIN = 10;
const PYEONG_MAX = 60;
const PYEONG_TICKS = [10, 24, 33, 40, 60];
const QUICK_MATERIAL_RATIO = 0.2;

type Mode = "quick" | "detail";

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** 3,300,000 → "330만". 견적은 만 원 단위로 끊기므로 큰 숫자는 이렇게 읽는 게 빠르다. */
function man(n: number): string {
  return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
}

const round10k = (n: number) => Math.round(n / 10_000) * 10_000;

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-[52px] shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-indigo-600" : "bg-[#d1d6db]"
      }`}
    >
      <span
        className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(25,31,40,0.3)] transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function QtyControl({
  qty,
  name,
  onAdd,
  onSub,
}: {
  qty: number;
  name: string;
  onAdd: () => void;
  onSub: () => void;
}) {
  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        aria-label={`${name} 추가`}
        className="h-11 shrink-0 rounded-full bg-indigo-50 px-5 text-[14px] font-bold text-indigo-700 transition-transform active:scale-95"
      >
        추가
      </button>
    );
  }
  return (
    <span className="flex h-11 shrink-0 items-center rounded-full bg-[#f2f4f6] px-1">
      <button
        type="button"
        onClick={onSub}
        aria-label={`${name} 하나 빼기`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[#4e5968] transition-colors active:bg-white"
      >
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="min-w-[1.75rem] text-center text-[16px] font-extrabold tabular-nums text-[#191f28]" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        onClick={onAdd}
        aria-label={`${name} 하나 더하기`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-indigo-700 transition-colors active:bg-white"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </span>
  );
}

export default function QuotePage() {
  const [mode, setMode] = useState<Mode>("quick");
  const [items, setItems] = useState<Record<string, EstimatorItem> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [result, setResult] = useState<EstimatorResult | null>(null);

  const [pyeong, setPyeong] = useState(24);
  const [withSash, setWithSash] = useState(true);
  const [withSink, setWithSink] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sim, setSim] = useState<{ open: boolean; seed: number; ratio: number; meters: number | null }>({
    open: false,
    seed: 0,
    ratio: QUICK_MATERIAL_RATIO,
    meters: null,
  });
  const [estimateNo, setEstimateNo] = useState("");
  const [pricingOpen, setPricingOpen] = useState(false);
  const calcSeq = useRef(0);

  useEffect(() => {
    getEstimatorItems()
      .then(setItems)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "품목 목록을 불러오지 못했습니다."));
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    setEstimateNo(`ED-${stamp}-${Math.floor(1000 + Math.random() * 9000)}`);
  }, []);

  // 단가 설정(사장님 전용)에서 원자재값·공임비를 고치고 나오면, 카드 가격 목록과
  // 이미 담아 둔 견적의 총액을 그 자리에서 다시 계산해 보여준다.
  function handlePricingClose() {
    setPricingOpen(false);
    getEstimatorItems()
      .then(setItems)
      .catch(() => {
        /* 실패해도 기존 목록을 유지 — 다음 조작에서 다시 시도된다 */
      });
    if (Object.keys(selections).length > 0) {
      calculateEstimator(selections)
        .then(setResult)
        .catch(() => {
          /* 표시는 이전 계산값 유지 */
        });
    }
  }

  // 선택이 바뀔 때마다 서버에서 다시 계산한다. 늦게 도착한 옛 응답이 새 응답을 덮지 않도록 순번을 둔다.
  useEffect(() => {
    const seq = ++calcSeq.current;
    calculateEstimator(selections)
      .then((r) => {
        if (seq === calcSeq.current) setResult(r);
      })
      .catch(() => {
        /* 표시는 이전 계산값 유지 — 일시적 실패로 화면을 비우지 않는다. */
      });
  }, [selections]);

  // 시트(견적서·내부 분석)가 열려 있는 동안 뒤 화면이 같이 스크롤되지 않게 한다.
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  const range = useMemo(() => {
    let mult = withSash ? 1 : 0.85;
    if (withSink) mult *= 1.15;
    return {
      min: round10k(pyeong * PYEONG_BASE_MIN * mult),
      max: round10k(pyeong * PYEONG_BASE_MAX * mult),
    };
  }, [pyeong, withSash, withSink]);

  const total = result?.total ?? 0;
  const itemCount = Object.values(selections).reduce((a, b) => a + b, 0);

  const groups = useMemo(() => {
    const out: { name: string; entries: [string, EstimatorItem][] }[] = [];
    if (!items) return out;
    for (const entry of Object.entries(items)) {
      const g = entry[1].group;
      let bucket = out.find((b) => b.name === g);
      if (!bucket) {
        bucket = { name: g, entries: [] };
        out.push(bucket);
      }
      bucket.entries.push(entry);
    }
    return out;
  }, [items]);

  function add(code: string) {
    setSelections((s) => ({ ...s, [code]: (s[code] ?? 0) + 1 }));
    if (navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch {
        /* 진동 미지원 기기는 무시 */
      }
    }
  }
  function sub(code: string) {
    setSelections((s) => {
      const next = { ...s };
      if ((next[code] ?? 0) <= 1) delete next[code];
      else next[code] -= 1;
      return next;
    });
  }

  function openSimFromRange() {
    setSim((s) => ({
      open: !s.open,
      seed: Math.round((range.min + range.max) / 2),
      ratio: QUICK_MATERIAL_RATIO,
      meters: null,
    }));
  }
  function openSimFromBar() {
    setSim((s) => ({
      open: !s.open,
      seed: total,
      ratio: result && total > 0 ? result.margin_analysis.material_ratio : QUICK_MATERIAL_RATIO,
      meters: result && total > 0 ? result.margin_analysis.film_meters : null,
    }));
  }

  const rangeSecret = useSecretTrigger(openSimFromRange);
  const barSecret = useSecretTrigger(openSimFromBar);
  // 사장님만 아는 입구: 화면 제목을 더블 탭하거나 길게 누르면 단가 설정이 열린다.
  // (메인 AI 견적의 "상호 배너 3초 길게 누르기"와 같은 자리 — 견적서 안 상호 뱃지도
  // 항목을 하나 이상 담아야 나타나므로, 아무것도 안 담은 채로도 열 수 있게 제목에도 둔다.)
  const titleSecret = useSecretTrigger(() => setPricingOpen(true));

  const rows: ReceiptRow[] = (result?.breakdown ?? []).map((b) => ({
    key: b.code,
    icon: <QuoteIcon code={b.code} tone={toneOfGroup(items?.[b.code]?.group ?? "")} size={36} />,
    name: b.label,
    tag: b.design_type,
    qtyLine: `${b.qty}개 × ${won(b.unit_price)}`,
    note: b.note,
    amount: b.line_total,
  }));

  const fill = ((pyeong - PYEONG_MIN) / (PYEONG_MAX - PYEONG_MIN)) * 100;

  return (
    <main className="fin-scope min-h-screen min-h-[100dvh] bg-[#f2f4f6] text-[#191f28]">
      <div className="mx-auto max-w-[480px] px-4 pb-44 pt-4">
        <header className="mb-5">
          <Link
            href="/"
            className="-ml-2 inline-flex h-11 items-center gap-1 rounded-xl px-2 text-[14px] font-medium text-[#4e5968] transition-colors active:bg-black/5"
          >
            <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
            AI 시공 미리보기
          </Link>
          <BrandHero aspect="aspect-[2/1]" className="mt-3" />
          <h1
            {...titleSecret}
            style={{ WebkitTouchCallout: "none", touchAction: "manipulation" }}
            className="mt-5 select-none text-[26px] font-extrabold leading-tight tracking-[-0.03em]"
          >
            프리미엄 견적 컨설턴트
          </h1>
          <p className="mt-1.5 text-[15px] text-[#5b6573]">현장에서 바로 완성도 높은 견적서를 보여드리세요</p>
        </header>

        <div className="relative mb-5 flex rounded-2xl bg-[#e5e8eb] p-1" role="tablist" aria-label="견적 방식">
          <span
            aria-hidden
            className="absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-xl bg-white shadow-[0_1px_4px_rgba(25,31,40,0.12)] transition-transform duration-300 ease-out"
            style={{ transform: mode === "detail" ? "translateX(100%)" : "translateX(0)" }}
          />
          {(
            [
              { id: "quick", label: "평수별 전체 견적" },
              { id: "detail", label: "부분 상세 견적" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => setMode(t.id)}
              className={`relative z-10 h-12 flex-1 whitespace-nowrap rounded-xl text-[15px] font-bold transition-colors ${
                mode === t.id ? "text-[#191f28]" : "text-[#6b7684]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "quick" ? (
          <div className="space-y-3">
            <section className="rounded-[24px] bg-white p-6 shadow-[0_1px_2px_rgba(25,31,40,0.04)]">
              <h2 className="text-[15px] font-semibold text-[#4e5968]">시공 평수</h2>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPyeong((p) => Math.max(PYEONG_MIN, p - 1))}
                  aria-label="1평 줄이기"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f2f4f6] text-[#4e5968] transition-transform active:scale-90"
                >
                  <Minus className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
                <p className="text-[48px] font-extrabold leading-none tracking-[-0.04em] tabular-nums" aria-live="polite">
                  {pyeong}
                  <span className="ml-1 text-[24px] font-bold tracking-normal text-[#4e5968]">평</span>
                </p>
                <button
                  type="button"
                  onClick={() => setPyeong((p) => Math.min(PYEONG_MAX, p + 1))}
                  aria-label="1평 늘리기"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f2f4f6] text-[#4e5968] transition-transform active:scale-90"
                >
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              </div>

              <div className="mt-4 px-1">
                <input
                  type="range"
                  min={PYEONG_MIN}
                  max={PYEONG_MAX}
                  step={1}
                  value={pyeong}
                  onChange={(e) => setPyeong(parseInt(e.target.value, 10))}
                  aria-label="시공 평수"
                  className="fin-range"
                  style={{ ["--fill" as string]: `${fill}%` }}
                />
                <div className="relative mx-[15px] mt-1 h-5 text-[12px] font-medium tabular-nums text-[#6b7684]">
                  {PYEONG_TICKS.map((t) => (
                    <span
                      key={t}
                      className="absolute -translate-x-1/2 whitespace-nowrap"
                      style={{ left: `${((t - PYEONG_MIN) / (PYEONG_MAX - PYEONG_MIN)) * 100}%` }}
                    >
                      {t}평
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-5 divide-y divide-[#eef0f2] border-t border-[#eef0f2]">
                <div className="flex min-h-[64px] items-center justify-between gap-4 py-2.5">
                  <div>
                    <p className="text-[16px] font-semibold">샷시 포함</p>
                    <p className="text-[13px] text-[#5b6573]">문 · 샷시 · 몰딩까지 전체 시공</p>
                  </div>
                  <Switch checked={withSash} onChange={setWithSash} label="샷시 포함" />
                </div>
                <div className="flex min-h-[64px] items-center justify-between gap-4 py-2.5">
                  <div>
                    <p className="text-[16px] font-semibold">싱크대 포함</p>
                    <p className="text-[13px] text-[#5b6573]">싱크대 필름 시공 추가</p>
                  </div>
                  <Switch checked={withSink} onChange={setWithSink} label="싱크대 포함" />
                </div>
              </div>
            </section>

            <section className="rounded-[24px] bg-indigo-600 p-6 text-white">
              <h2 className="text-[15px] font-semibold text-white">
                {pyeong}평 {withSash ? "전체" : "샷시 제외"}
                {withSink ? " · 싱크대 포함" : ""} 프리미엄 리폼 세트
              </h2>
              <p
                {...rangeSecret}
                style={{ WebkitTouchCallout: "none", touchAction: "manipulation" }}
                className="mt-3 cursor-pointer select-none text-[34px] font-extrabold leading-none tracking-[-0.03em] tabular-nums"
              >
                {man(range.min)} ~ {man(range.max)}
                <span className="ml-1 text-[20px] font-bold">원</span>
              </p>
              <p className="mt-2 text-[14px] tabular-nums text-indigo-100">
                {won(range.min)} ~ {won(range.max)}
              </p>
              <p className="mt-4 border-t border-white/20 pt-4 text-[13px] leading-[1.6] text-indigo-100">
                현장 실측 후 최종 확정되며, 본 견적은 표준 기준입니다.
              </p>
            </section>
          </div>
        ) : (
          <div className="space-y-6">
            {loadError ? (
              <div className="rounded-2xl bg-red-50 p-4 text-[14px] text-red-800" role="alert">
                {loadError}
              </div>
            ) : !items ? (
              <div className="flex items-center justify-center gap-2 py-20 text-[14px] text-[#5b6573]">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                품목을 불러오는 중입니다
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.name}>
                  <h2 className="mb-2 px-1 text-[15px] font-bold text-[#191f28]">{g.name}</h2>
                  <ul className="divide-y divide-[#eef0f2] rounded-[24px] bg-white px-4 shadow-[0_1px_2px_rgba(25,31,40,0.04)]">
                    {g.entries.map(([code, item]) => (
                      <li key={code} className="flex min-h-[80px] items-center gap-3.5 py-3">
                        <QuoteIcon code={code} tone={toneOfGroup(item.group)} size={44} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold leading-snug">{item.label}</p>
                          <p className="mt-0.5 whitespace-nowrap text-[13px] tabular-nums text-[#5b6573]">{won(item.price)}</p>
                          {item.design_type && <p className="mt-0.5 text-[12.5px] text-[#6b7684]">{item.design_type}</p>}
                        </div>
                        <QtyControl
                          qty={selections[code] ?? 0}
                          name={item.label}
                          onAdd={() => add(code)}
                          onSub={() => sub(code)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </div>

      {/* 하단 총액 바 — 상세 견적에서만 */}
      {mode === "detail" && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#e5e8eb] bg-white pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex max-w-[480px] items-center justify-between gap-4 px-4">
            <div className="min-w-0">
              <p className="text-[13px] text-[#5b6573]">
                총 예상 견적{itemCount > 0 && <span className="ml-1.5 tabular-nums">· {itemCount}개 품목</span>}
              </p>
              <p
                {...barSecret}
                style={{ WebkitTouchCallout: "none", touchAction: "manipulation" }}
                className="mt-0.5 cursor-pointer select-none text-[26px] font-extrabold leading-none tracking-[-0.03em] tabular-nums"
              >
                {total.toLocaleString("ko-KR")}
                <span className="ml-0.5 text-[16px] font-bold text-[#4e5968]">원</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              disabled={itemCount === 0}
              className="h-14 shrink-0 rounded-2xl bg-indigo-600 px-7 text-[16px] font-bold text-white transition-transform active:scale-[0.97] disabled:bg-[#e5e8eb] disabled:text-[#6b7684]"
            >
              견적서 보기
            </button>
          </div>
        </div>
      )}

      {/* 견적서(영수증) 시트 */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            aria-label="견적서 닫기"
            onClick={() => setSheetOpen(false)}
            className="fin-backdrop absolute inset-0 cursor-default bg-black/40"
          />
          <section
            role="dialog"
            aria-label="견적서"
            className="fin-sheet relative max-h-[94vh] w-full max-w-[480px] overflow-y-auto rounded-t-[28px] bg-[#f2f4f6] px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3"
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[#c5cad1]" />
            <div className="mb-2 flex items-center justify-between">
              <h2 className="pl-1 text-[17px] font-bold">견적서</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="견적서 닫기"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#4e5968]"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
            <PremiumReceiptView
              rows={rows}
              supplyAmount={total}
              vat={null}
              total={total}
              materialTotal={result?.margin_analysis.material_cost ?? 0}
              expenseTotal={0}
              estimateNo={estimateNo}
              onSecretHold={() => setPricingOpen(true)}
            />
            <button
              type="button"
              onClick={() => {
                setSelections({});
                setSheetOpen(false);
              }}
              className="mx-auto mt-2 flex h-11 items-center px-4 text-[14px] text-[#5b6573] underline underline-offset-4"
            >
              전체 초기화
            </button>
          </section>
        </div>
      )}

      <CrewSimulator
        open={sim.open}
        seedTotal={sim.seed}
        materialRatio={sim.ratio}
        filmMeters={sim.meters}
        onClose={() => setSim((s) => ({ ...s, open: false }))}
      />

      {/* 단가 설정(사장님 전용) — 제목이나 견적서 안 상호 뱃지를 길게 누르면 열린다.
          품목별 원자재값·공임비를 여기서 직접 고친다. */}
      <PricingSheet
        open={pricingOpen}
        onClose={handlePricingClose}
        title="단가 설정"
        description="품목별 원자재값·공임비를 직접 고칠 수 있습니다. 저장하면 이후 모든 빠른 견적에 바로 반영됩니다"
        getFields={getEstimatorPricing}
        saveFields={saveEstimatorPricing}
      />
    </main>
  );
}
