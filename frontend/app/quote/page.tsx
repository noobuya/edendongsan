"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Minus, Plus, X } from "lucide-react";
import BrandHero from "@/components/BrandHero";
import CrewSimulator from "@/components/CrewSimulator";
import { PremiumReceiptView, useSecretTrigger, type ReceiptRow } from "@/components/PremiumReceipt";
import PricingSheet from "@/components/PricingSheet";
import { useSwipeNavigate } from "@/lib/useSwipeNavigate";
import QuoteIcon, { toneOfGroup } from "@/components/quote/QuoteIcon";
import {
  calculateEstimator,
  getEstimatorItems,
  getEstimatorPricing,
  saveEstimatorPricing,
  type DoorDesignType,
  type DoorDetail,
  type EstimatorItem,
  type EstimatorResult,
} from "@/lib/api";

// 실리콘 제거·재시공 추가 옵션을 고를 수 있는 품목 — 기존 자재를 뜯어내는 시공만
// 해당된다(estimator_app/app.py의 ADDON_ITEMS.SILICONE_RECOAT.applicable_to와 일치).
const SILICONE_ADDON_CODES = new Set([
  "DOOR_SET",
  "SASH_SMALL",
  "SASH_LARGE",
  "MOLDING_FLAT",
  "MOLDING_CROWN",
  "BASEBOARD",
  "WARDROBE_SET",
  "WELL_MOLDING",
  "SHOE_CABINET",
]);
const DEFAULT_DOOR_DETAIL: DoorDetail = { design_type: "flat", width_mm: 900, height_mm: 2100 };

// 평수별 전체 견적의 표준 단가(원/평) — QUICK_TOGGLES의 "핵심 시공" weight
// 합이 1(= 전부 기본값)일 때 적용되는 가격이다. 아래 QUICK_TOGGLES 설명 참고.
const PYEONG_BASE_MIN = 160_800;
const PYEONG_BASE_MAX = 190_000;
const PYEONG_MIN = 10;
const PYEONG_MAX = 60;
const PYEONG_TICKS = [10, 24, 33, 40, 60];
const QUICK_MATERIAL_RATIO = 0.2;

type Mode = "quick" | "detail";

// [히스토리 요약 — 이전엔 "offMult/onMult를 곱한다"는 모델이었다]
// 2026-11-07부터 2026-11-21까지 여러 번 가격을 고치면서(estimator_app
// 단가 정정 → 평수별 비중 재계산 반복), "핵심 시공" 항목들을 "곱셈 배수
// (mult *= on? onMult : offMult)"로 다뤘다. 문제는 2026-11-21에 발견됐다
// — "벽면 포함"처럼 비중이 큰 항목 하나를 혼자 꺼도 곱셈이라 전체가 그
// 비중만큼 통째로 꺾여버렸다(원래는 "다른 걸 다 껐을 때" 기준으로 역산한
// 값인데, 곱셈 모델에서는 "혼자 꺼도" 똑같이 적용돼 가격이 비정상적으로
// 뚝 떨어지는 버그였다). 그래서 모델을 "덧셈 비중(weight)"으로 바꿨다:
//
// [현재 모델 — 2026-11-21]
// "핵심 시공" 기본 포함 항목들(wallFilm/door/sash/molding/baseboard/sinkL/
// sinkIsland/middleDoor/fireDoor/wardrobe/shoeCabinet/fridgeCabinet/
// wellMolding)은 전체 100%를 나눠 가진 weight를 갖고, 합이 정확히 1이다.
// 최종 배수 = (켜진 핵심 항목들의 weight 합) + (켜진 업그레이드/추가 항목의
// addonWeight 합). 이러면 다 끄면 정확히 0, 하나만 꺼도 그 항목의 몫만큼만
// 빠진다 — "벽면만 꺼도 전체가 꺾이는" 문제가 구조적으로 없어진다.
// weight 값은 전부 이전 offMult에서 그대로 환산했다(weight ≈ 1-offMult —
// 원래도 offMult 자체가 "item_price/(기준 평수×평당 중간값)"에서 역산한
// 작은 배수라 큰 오차 없이 그대로 재사용 가능하다). wallFilm의 weight(0.38)
// 만 "나머지 12개 weight 합(0.62)을 1에서 뺀 값"으로 새로 구했다 — wallFilm은
// 토글이 생기기 전부터 평당가 안에 숨어있던 "문/샷시/싱크대 등 이름 붙은
// 품목 말고 남는 전부"(벽·천장 등)였기 때문에 자기 몫이 따로 측정된 적이
// 없었다.
// sinkStraight(일자 싱크대)·crownMolding(장식몰딩)은 "핵심 100%" 안의
// 몫이 아니라 addonWeight로 다룬다 — sinkStraight는 sinkL의 자리를
// 대신 차지하는 교체(replaces: "sinkL", 그 자리 weight 대신 자기 weight를
// 더함), crownMolding은 molding 위에 얹는 순수 추가(업그레이드 프리미엄).
// 전기·조명·설비(실링팬/다운라이트/싱크볼/변기)도 전부 addonWeight로 —
// 켜면 핵심 시공 상태와 무관하게 항상 같은 몫만큼 더한다.
//
// PYEONG_BASE_MIN/MAX(16.08만~19만 원/평)는 안 바뀐다 — 핵심 항목 전부
// 기본값 그대로(weight 합 1)일 때의 가격이 지금까지의 "올인클루시브" 가격과
// 똑같아야 하므로, 모델만 바꾸고 숫자는 그대로 이어받았다. 실측 전 참고용
// 범위이므로 정확한 금액이 필요하면 부분 상세 견적을 쓴다.
interface QuickToggleDef {
  key: string;
  label: string;
  desc: string;
  group: "핵심 시공" | "전기·조명·설비";
  defaultOn: boolean;
  /** "핵심 시공" 기본 포함 항목: 전체 100% 중 이 항목의 몫. 이 항목들끼리
   *  합이 정확히 1이 되도록 맞춘다. addonWeight를 쓰는 항목은 비워둔다. */
  weight?: number;
  /** 업그레이드·교체·독립 추가 항목(장식몰딩/일자 싱크대/전기·조명·설비):
   *  켜면 위 weight 합에 그대로 더한다. */
  addonWeight?: number;
  /** addonWeight 항목이 다른 핵심 항목의 "자리"를 대신 차지하는 경우(예:
   *  일자 싱크대가 ㄱ자 싱크대 자리를 대신함) 그 핵심 항목의 key. */
  replaces?: string;
}
const QUICK_TOGGLES: QuickToggleDef[] = [
  { key: "wallFilm", label: "벽면 포함", desc: "벽·천장 등 기본 필름 시공", group: "핵심 시공", defaultOn: true, weight: 0.38 },
  { key: "door", label: "문 포함", desc: "문짝 필름 시공", group: "핵심 시공", defaultOn: true, weight: 0.07 },
  { key: "sash", label: "샷시 포함", desc: "샷시(창틀) 필름 시공", group: "핵심 시공", defaultOn: true, weight: 0.08 },
  { key: "molding", label: "몰딩 포함", desc: "천장·벽 평몰딩(민자) 라인 필름 시공", group: "핵심 시공", defaultOn: true, weight: 0.07 },
  { key: "crownMolding", label: "장식몰딩 추가", desc: "웨인스코팅·알판 등 장식 몰딩으로 업그레이드 — 보통 집엔 없어 기본 꺼짐", group: "핵심 시공", defaultOn: false, addonWeight: 0.08 },
  { key: "baseboard", label: "걸레받이 포함", desc: "바닥과 맞닿는 걸레받이 필름 시공", group: "핵심 시공", defaultOn: true, weight: 0.04 },
  { key: "sinkL", label: "ㄱ자 싱크대 포함", desc: "ㄱ자 싱크대 상하부장 필름 시공", group: "핵심 시공", defaultOn: true, weight: 0.09 },
  { key: "sinkStraight", label: "일자 싱크대 포함", desc: "일자(스트레이트) 싱크대로 교체 — ㄱ자와 동시 선택 불가", group: "핵심 시공", defaultOn: false, addonWeight: 0.06, replaces: "sinkL" },
  { key: "sinkIsland", label: "아일랜드장 포함", desc: "아일랜드 식탁·수납장 필름 시공", group: "핵심 시공", defaultOn: true, weight: 0.04 },
  { key: "middleDoor", label: "중문 포함", desc: "중문 리폼 시공", group: "핵심 시공", defaultOn: true, weight: 0.07 },
  { key: "fireDoor", label: "현관 방화문 포함", desc: "현관 방화문 리폼 시공", group: "핵심 시공", defaultOn: true, weight: 0.05 },
  { key: "wardrobe", label: "붙박이장 포함", desc: "붙박이장 리폼 시공", group: "핵심 시공", defaultOn: true, weight: 0.03 },
  { key: "shoeCabinet", label: "신발장 포함", desc: "신발장 리폼 시공", group: "핵심 시공", defaultOn: true, weight: 0.01 },
  { key: "fridgeCabinet", label: "냉장고장 포함", desc: "냉장고장 리폼 시공", group: "핵심 시공", defaultOn: true, weight: 0.03 },
  { key: "wellMolding", label: "우물몰딩 포함", desc: "우물천장 몰딩 시공(방 1개 기준)", group: "핵심 시공", defaultOn: true, weight: 0.04 },
  { key: "fan", label: "실링팬", desc: "실링팬 설치 추가", group: "전기·조명·설비", defaultOn: false, addonWeight: 0.06 },
  { key: "downlight", label: "다운라이트", desc: "다운라이트 타공·배선 추가(5개 기준)", group: "전기·조명·설비", defaultOn: false, addonWeight: 0.06 },
  { key: "sinkBowl", label: "싱크볼 교체", desc: "싱크볼 교환 시공 추가", group: "전기·조명·설비", defaultOn: false, addonWeight: 0.08 },
  { key: "toilet", label: "변기 교체", desc: "변기 설치 시공 추가", group: "전기·조명·설비", defaultOn: false, addonWeight: 0.08 },
];
const QUICK_TOGGLE_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  QUICK_TOGGLES.map((t) => [t.key, t.defaultOn])
);
// ㄱ자·일자 싱크대는 같은 카운터의 모양 중 하나라 동시에 켜질 수 없다 — 한쪽을
// 켜면 같은 그룹의 나머지를 toggleQuick에서 자동으로 끈다.
const EXCLUSIVE_TOGGLE_GROUPS: string[][] = [["sinkL", "sinkStraight"]];

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
  const [doorDetail, setDoorDetail] = useState<DoorDetail>(DEFAULT_DOOR_DETAIL);
  const [addons, setAddons] = useState<Record<string, string[]>>({});
  // [왜 — 2026-11-07 "현장에서 시공부위 가격을 수동으로 고치게 해줘"] 현장에서
  // 고객과 가격을 조율할 때, 자동 계산값 위에 품목별로(또는 총액 한 번에) 직접
  // 숫자를 얹어 쓴다. 선택한 품목 구성 자체가 바뀌면(추가/삭제) 옛 수동값이
  // 지금 구성과 안 맞으니 자동으로 지운다(아래 effect).
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});

  const [pyeong, setPyeong] = useState(24);
  // 품목 토글 전부를 하나의 객체로 — 14개를 따로따로 useState로 두면 다루기
  // 어렵다. key는 QUICK_TOGGLES의 key와 같다.
  const [quickToggles, setQuickToggles] = useState<Record<string, boolean>>(QUICK_TOGGLE_DEFAULTS);
  function toggleQuick(key: string) {
    setQuickToggles((prev) => {
      const turningOn = !prev[key];
      const next = { ...prev, [key]: turningOn };
      if (turningOn) {
        const group = EXCLUSIVE_TOGGLE_GROUPS.find((g) => g.includes(key));
        for (const other of group ?? []) {
          if (other !== key) next[other] = false;
        }
      }
      return next;
    });
  }

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
      calculateEstimator(selections, doorDetail, addons)
        .then(setResult)
        .catch(() => {
          /* 표시는 이전 계산값 유지 */
        });
    }
  }

  // 선택(품목·수량/문짝 크기·디자인/실리콘 추가옵션)이 바뀔 때마다 서버에서 다시
  // 계산한다. 늦게 도착한 옛 응답이 새 응답을 덮지 않도록 순번을 둔다.
  useEffect(() => {
    const seq = ++calcSeq.current;
    calculateEstimator(selections, doorDetail, addons)
      .then((r) => {
        if (seq === calcSeq.current) setResult(r);
      })
      .catch(() => {
        /* 표시는 이전 계산값 유지 — 일시적 실패로 화면을 비우지 않는다. */
      });
    // 품목 구성이 바뀌면 그 전에 손으로 고친 금액은 더 안 맞으니 비운다.
    setPriceOverrides({});
  }, [selections, doorDetail, addons]);

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
    let mult = 0;
    // 핵심 시공 weight 합 — 다른 토글이 그 자리를 대신하는(replaces) 항목은
    // 건너뛴다(예: 일자 싱크대가 켜져 있으면 ㄱ자 싱크대 몫은 안 더한다).
    for (const t of QUICK_TOGGLES) {
      if (t.weight === undefined) continue;
      const takenOver = QUICK_TOGGLES.some(
        (o) => o.replaces === t.key && (quickToggles[o.key] ?? o.defaultOn)
      );
      if (takenOver) continue;
      const on = quickToggles[t.key] ?? t.defaultOn;
      if (on) mult += t.weight;
    }
    // 업그레이드·교체·독립 추가 항목 — 켜져 있으면 그대로 더한다.
    for (const t of QUICK_TOGGLES) {
      if (t.addonWeight === undefined) continue;
      const on = quickToggles[t.key] ?? t.defaultOn;
      if (on) mult += t.addonWeight;
    }
    return {
      min: round10k(pyeong * PYEONG_BASE_MIN * mult),
      max: round10k(pyeong * PYEONG_BASE_MAX * mult),
    };
  }, [pyeong, quickToggles]);

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

  function toggleSiliconeAddon(code: string) {
    setAddons((a) => {
      const has = (a[code] ?? []).includes("SILICONE_RECOAT");
      if (has) {
        const next = { ...a };
        delete next[code];
        return next;
      }
      return { ...a, [code]: ["SILICONE_RECOAT"] };
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

  // 손으로 고친 금액(priceOverrides)이 있으면 그 품목만 그 값으로 바꿔 보여준다
  // — 나머지는 자동 계산값 그대로. 총액은 이 (보정된) 줄들의 합이라, 품목을
  // 고치면 총액도, 총액을 고치면(아래 handleEditTotal) 품목들도 서로 맞는다.
  const rows: ReceiptRow[] = (result?.breakdown ?? []).map((b) => ({
    key: b.code,
    icon: <QuoteIcon code={b.code} tone={toneOfGroup(items?.[b.code]?.group ?? "")} size={36} />,
    name: b.label,
    tag: b.design_type,
    qtyLine: `${b.qty}개 × ${won(b.unit_price)}`,
    note: b.note,
    amount: priceOverrides[b.code] ?? b.line_total,
  }));
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  function handleEditRowAmount(key: string, newAmount: number) {
    setPriceOverrides((prev) => ({ ...prev, [key]: newAmount }));
  }

  // 총액을 직접 고치면, 지금 비율(새 총액 ÷ 지금 총액)을 모든 품목에 똑같이
  // 곱해 품목별 금액도 같이 맞춘다 — PremiumReceiptView의 onAdjustTotal은
  // 원래 서버에 저장하는 비동기 함수용이라, 여기서는 로컬 상태만 바꾸고
  // 바로 끝낸 Promise를 돌려준다(이 화면은 저장할 "견적서"가 따로 없다).
  async function handleEditTotal(newTotal: number) {
    if (total <= 0 || rows.length === 0) return;
    const ratio = newTotal / total;
    const scaled = rows.map((r) => ({ key: r.key, amount: Math.round(r.amount * ratio) }));
    // 반올림 오차는 가장 비싼 품목에 몰아 합계를 정확히 새 총액과 맞춘다.
    const drift = newTotal - scaled.reduce((s, r) => s + r.amount, 0);
    if (drift) {
      const biggest = scaled.reduce((a, b) => (b.amount > a.amount ? b : a));
      biggest.amount += drift;
    }
    setPriceOverrides((prev) => {
      const next = { ...prev };
      for (const r of scaled) next[r.key] = r.amount;
      return next;
    });
  }

  const fill = ((pyeong - PYEONG_MIN) / (PYEONG_MAX - PYEONG_MIN)) * 100;
  useSwipeNavigate("/quote", !sheetOpen && !pricingOpen);

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

              {(["핵심 시공", "전기·조명·설비"] as const).map((groupName) => (
                <div key={groupName} className="mt-5">
                  <p className="px-1 text-[12.5px] font-bold uppercase tracking-wide text-[#8b95a1]">{groupName}</p>
                  <div className="mt-1.5 divide-y divide-[#eef0f2] border-t border-[#eef0f2]">
                    {QUICK_TOGGLES.filter((t) => t.group === groupName).map((t) => (
                      <div key={t.key} className="flex min-h-[64px] items-center justify-between gap-4 py-2.5">
                        <div>
                          <p className="text-[16px] font-semibold">{t.label}</p>
                          <p className="text-[13px] text-[#5b6573]">{t.desc}</p>
                        </div>
                        <Switch
                          checked={quickToggles[t.key] ?? t.defaultOn}
                          onChange={() => toggleQuick(t.key)}
                          label={t.label}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {/* [왜 — 2026-11-07] "욕실문은 문틀만, 안방엔 우물몰딩만"처럼 방 하나·
                  부위 하나만 다르게 하는 요청은 평수 범위 견적(전체 평수에 걸친
                  대략적 단가)으로는 정확히 표현할 수 없다 — 그런 요청은 아래
                  "부분 상세 견적" 탭에서 그 품목만 골라 담으면 정확하게 나온다. */}
              <p className="mt-4 rounded-xl bg-[#f2f4f6] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#6b7684]">
                "욕실문은 문틀만", "안방에만 우물몰딩"처럼 방·부위 하나만 다르게
                해야 하면 이 범위 견적 대신 <b>부분 상세 견적</b> 탭에서 그 품목만
                담아 보세요 — 정확한 금액이 나옵니다.
              </p>
            </section>

            <section className="rounded-[24px] bg-indigo-600 p-6 text-white">
              <h2 className="text-[15px] font-semibold text-white">
                {pyeong}평 맞춤 구성 프리미엄 리폼 세트
                {(() => {
                  const extras = QUICK_TOGGLES.filter(
                    (t) => t.group !== "핵심 시공" && (quickToggles[t.key] ?? t.defaultOn)
                  );
                  return extras.length > 0 ? ` · 추가 ${extras.length}건` : "";
                })()}
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
                    {g.entries.map(([code, item]) => {
                      const qty = selections[code] ?? 0;
                      const showDoorDetail = code === "DOOR_SET" && qty > 0;
                      const showSiliconeAddon = SILICONE_ADDON_CODES.has(code) && qty > 0;
                      return (
                        <li key={code} className="py-3">
                          <div className="flex min-h-[80px] items-center gap-3.5">
                            <QuoteIcon code={code} tone={toneOfGroup(item.group)} size={44} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[15px] font-semibold leading-snug">{item.label}</p>
                              <p className="mt-0.5 whitespace-nowrap text-[13px] tabular-nums text-[#5b6573]">
                                {won(item.price)}
                                {code === "DOOR_SET" && doorDetail.design_type === "pattern" && " + 난이도 할증"}
                              </p>
                              {code !== "DOOR_SET" && item.design_type && (
                                <p className="mt-0.5 text-[12.5px] text-[#6b7684]">{item.design_type}</p>
                              )}
                            </div>
                            <QtyControl qty={qty} name={item.label} onAdd={() => add(code)} onSub={() => sub(code)} />
                          </div>

                          {/* 문짝 크기·디자인 — 알판/무늬를 고르면 문 크기에 비례해 할증이 자동으로 붙는다. */}
                          {showDoorDetail && (
                            <div className="ml-[60px] space-y-2.5 pb-1">
                              <div className="flex gap-2">
                                {(
                                  [
                                    { id: "flat" as const, label: "민자" },
                                    { id: "pattern" as const, label: "알판·무늬" },
                                  ]
                                ).map((o) => (
                                  <button
                                    key={o.id}
                                    type="button"
                                    onClick={() => setDoorDetail((d) => ({ ...d, design_type: o.id as DoorDesignType }))}
                                    aria-pressed={doorDetail.design_type === o.id}
                                    className={`h-9 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                                      doorDetail.design_type === o.id ? "bg-indigo-600 text-white" : "bg-[#f2f4f6] text-[#4e5968]"
                                    }`}
                                  >
                                    {o.label}
                                  </button>
                                ))}
                              </div>
                              {doorDetail.design_type === "pattern" && (
                                <div className="flex items-center gap-2 text-[13px] text-[#5b6573]">
                                  <label className="flex items-center gap-1.5">
                                    가로
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      value={doorDetail.width_mm ?? 0}
                                      onChange={(e) => setDoorDetail((d) => ({ ...d, width_mm: Number(e.target.value) || 0 }))}
                                      className="h-9 w-20 rounded-lg border border-[#d1d6db] bg-white px-2 text-right tabular-nums"
                                    />
                                    mm
                                  </label>
                                  <label className="flex items-center gap-1.5">
                                    세로
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      value={doorDetail.height_mm ?? 0}
                                      onChange={(e) => setDoorDetail((d) => ({ ...d, height_mm: Number(e.target.value) || 0 }))}
                                      className="h-9 w-20 rounded-lg border border-[#d1d6db] bg-white px-2 text-right tabular-nums"
                                    />
                                    mm
                                  </label>
                                </div>
                              )}
                            </div>
                          )}

                          {/* 기존 실리콘 제거·재시공 — 기본가에 포함하지 않는 별도 청구 옵션. */}
                          {showSiliconeAddon && (
                            <label className="ml-[60px] flex items-center gap-2 pb-1 text-[13px] text-[#5b6573]">
                              <input
                                type="checkbox"
                                checked={(addons[code] ?? []).includes("SILICONE_RECOAT")}
                                onChange={() => toggleSiliconeAddon(code)}
                                className="h-4 w-4 accent-indigo-600"
                              />
                              기존 실리콘 제거 및 재시공 (별도 청구)
                            </label>
                          )}
                        </li>
                      );
                    })}
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
              minCalloutApplied={result?.min_callout_applied}
              minCalloutNote={result?.min_callout_note}
              deposit={result?.deposit}
              salesPitch={result?.sales_pitch}
              roiComparison={result?.roi_comparison}
              onEditRowAmount={handleEditRowAmount}
              onAdjustTotal={handleEditTotal}
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
