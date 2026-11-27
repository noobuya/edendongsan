"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Fuel, Loader2, Plus, Trash2 } from "lucide-react";
import { createLedgerEntry, type LedgerEntryInput } from "@/lib/api";

const TOKEN_KEY = "eden-admin-token";
const FUEL_SETTINGS_KEY = "eden-daily-fuel-settings";

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toNumber(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type VehicleType = "diesel" | "gasoline" | "electric";

// 유가는 매일 바뀌니 정확한 값이 아니라 "일단 계산해 볼 수 있는" 기본값이다 —
// 저장된 적 없으면 이 값으로 시작하고, 직접 고치면 다음에도(localStorage) 그 값을 쓴다.
const DEFAULT_FUEL_PRICE: Record<VehicleType, number> = { diesel: 1600, gasoline: 1700, electric: 300 };
const VEHICLE_LABEL: Record<VehicleType, string> = { diesel: "경유차", gasoline: "휘발유차", electric: "전기차" };
const FUEL_UNIT: Record<VehicleType, string> = { diesel: "원/L", gasoline: "원/L", electric: "원/kWh" };
const EFFICIENCY_UNIT: Record<VehicleType, string> = { diesel: "km/L", gasoline: "km/L", electric: "km/kWh" };

interface AmountItem {
  label: string;
  amount: string;
}

interface FuelSettings {
  vehicleType: VehicleType;
  efficiency: string;
  fuelPrice: string;
}

function loadFuelSettings(): FuelSettings {
  try {
    const raw = localStorage.getItem(FUEL_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // 저장된 값이 없거나 깨졌으면 기본값으로 시작한다.
  }
  return { vehicleType: "gasoline", efficiency: "", fuelPrice: String(DEFAULT_FUEL_PRICE.gasoline) };
}

const input =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500";
const smallInput =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 outline-none focus:border-indigo-500";
const label = "mb-1.5 block text-[12.5px] font-semibold text-slate-500";

/** 오늘 현장 정산 — 작업 견적(자동 매출 집계)과 무관하게, 사장님이 그날 실제로
 *  받은 돈과 실제로 쓴 돈(재료값·인건비·밥값·기름값·기타)을 직접 입력해 하루
 *  단위 손익을 바로 확인하는 화면. 저장하면 각 항목이 기존 가게부(/admin/ledger)의
 *  수동 항목으로 하나씩 들어가, 그 화면의 월별 집계에도 그대로 합산된다.
 *
 *  기름값은 "차종 + 연비 + 유가"와 "고객 왕복 거리 + 자재 구매 왕복 거리"로
 *  자동 계산한다(사장님 요청) — 계산값은 그대로 저장해도 되고, 실제 주유한
 *  금액과 다르면 직접 고쳐서 저장해도 된다. */
export default function DailySettlementPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);

  const [date, setDate] = useState(todayIso);
  const [counterparty, setCounterparty] = useState("");

  const [income, setIncome] = useState("");
  const [materialCost, setMaterialCost] = useState("");
  const [laborItems, setLaborItems] = useState<AmountItem[]>([{ label: "기공비", amount: "" }]);
  const [mealCost, setMealCost] = useState("");
  const [otherItems, setOtherItems] = useState<AmountItem[]>([{ label: "간식비", amount: "" }]);

  const [fuel, setFuel] = useState<FuelSettings>(() => loadFuelSettings());
  const [customerDistance, setCustomerDistance] = useState("");
  const [materialTripDistance, setMaterialTripDistance] = useState("");
  const [fuelCostOverride, setFuelCostOverride] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  useEffect(() => {
    const saved = readToken();
    if (saved) {
      setToken(saved);
      setAuthorized(true);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FUEL_SETTINGS_KEY, JSON.stringify(fuel));
    } catch {
      // 저장 실패해도 화면 사용에는 지장 없다.
    }
  }, [fuel]);

  // 왕복 거리 = (고객 거리 + 자재 구매 거리) × 2. 자재 구매 거리는 입력 안 하면 0으로 취급한다.
  const roundTripKm = (toNumber(customerDistance) + toNumber(materialTripDistance)) * 2;
  const efficiencyNum = toNumber(fuel.efficiency);
  const fuelPriceNum = toNumber(fuel.fuelPrice);
  const calculatedFuelCost = efficiencyNum > 0 ? (roundTripKm / efficiencyNum) * fuelPriceNum : 0;
  const fuelCost = fuelCostOverride !== null ? toNumber(fuelCostOverride) : calculatedFuelCost;

  const laborTotal = laborItems.reduce((sum, i) => sum + toNumber(i.amount), 0);
  const otherTotal = otherItems.reduce((sum, i) => sum + toNumber(i.amount), 0);
  const incomeTotal = toNumber(income);
  const expenseTotal = toNumber(materialCost) + laborTotal + toNumber(mealCost) + fuelCost + otherTotal;
  const net = incomeTotal - expenseTotal;

  function updateItem(list: AmountItem[], setList: (v: AmountItem[]) => void, i: number, patch: Partial<AmountItem>) {
    setList(list.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  }

  const canSave = date.trim().length > 0 && (incomeTotal > 0 || expenseTotal > 0);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSavedCount(null);
    const entries: LedgerEntryInput[] = [];
    const push = (type: "income" | "expense", category: string, amount: number, memo = "") => {
      if (amount > 0) entries.push({ date, type, category, counterparty: counterparty.trim(), amount: Math.round(amount), memo });
    };
    push("income", "받은 금액", incomeTotal);
    push("expense", "재료값", toNumber(materialCost));
    laborItems.forEach((item) => push("expense", item.label.trim() || "인건비", toNumber(item.amount)));
    push("expense", "밥값", toNumber(mealCost));
    push(
      "expense",
      "기름값",
      fuelCost,
      `${VEHICLE_LABEL[fuel.vehicleType]} · 연비 ${fuel.efficiency || "-"}${EFFICIENCY_UNIT[fuel.vehicleType]} · 왕복 ${roundTripKm.toFixed(1)}km`
    );
    otherItems.forEach((item) => push("expense", item.label.trim() || "기타", toNumber(item.amount)));

    try {
      for (const e of entries) await createLedgerEntry(e, token);
      setSavedCount(entries.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setIncome("");
    setMaterialCost("");
    setLaborItems([{ label: "기공비", amount: "" }]);
    setMealCost("");
    setOtherItems([{ label: "간식비", amount: "" }]);
    setCustomerDistance("");
    setMaterialTripDistance("");
    setFuelCostOverride(null);
    setCounterparty("");
    setSavedCount(null);
  }

  if (!authorized) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">관리자 로그인</h1>
        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[14px] text-slate-600">서버에 설정된 관리자 토큰을 입력하세요.</p>
          <input
            type="password"
            className={input}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="관리자 토큰"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && tokenInput.trim()) {
                try {
                  sessionStorage.setItem(TOKEN_KEY, tokenInput.trim());
                } catch {}
                setToken(tokenInput.trim());
                setAuthorized(true);
              }
            }}
          />
          <button
            onClick={() => {
              if (!tokenInput.trim()) return;
              try {
                sessionStorage.setItem(TOKEN_KEY, tokenInput.trim());
              } catch {}
              setToken(tokenInput.trim());
              setAuthorized(true);
            }}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white"
          >
            들어가기
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6 pb-28">
      <header className="flex items-center gap-2">
        <Link href="/admin/ledger" aria-label="가게부로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[18px] font-bold text-slate-900">오늘 현장 정산</h1>
      </header>

      <p className="rounded-xl bg-indigo-50 px-3.5 py-3 text-[13px] leading-relaxed text-indigo-800">
        작업 견적서와는 별개로, 오늘 실제로 받은 돈과 실제로 쓴 돈을 직접 적어 그날 손익을 바로 확인해요.
        저장하면 가게부(/admin/ledger)에 항목별로 한 줄씩 들어갑니다.
      </p>

      {error && <p className="px-1 text-[13px] font-semibold text-rose-700">{error}</p>}
      {savedCount !== null && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
          <p className="text-[13.5px] font-bold text-emerald-800">✓ {savedCount}건 저장했어요. 오늘 순이익 {won(net)}</p>
          <div className="flex gap-2">
            <Link href="/admin/ledger" className="text-[12.5px] font-semibold text-emerald-700 underline">
              가게부에서 보기
            </Link>
            <button type="button" onClick={resetForm} className="text-[12.5px] font-semibold text-emerald-700 underline">
              새로 입력하기
            </button>
          </div>
        </div>
      )}

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>날짜</span>
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <span className={label}>현장/고객명 (선택)</span>
            <input className={input} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="예: OO아파트" />
          </div>
        </div>
        <div>
          <span className={label}>오늘 받은 금액</span>
          <input
            type="number"
            inputMode="numeric"
            className={input}
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            placeholder="0"
          />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-[13px] font-bold text-slate-500">지출</p>

        <div>
          <span className={label}>재료값</span>
          <input
            type="number"
            inputMode="numeric"
            className={smallInput}
            value={materialCost}
            onChange={(e) => setMaterialCost(e.target.value)}
            placeholder="0"
          />
        </div>

        <div>
          <span className={label}>인건비 (조공비·기공비 등)</span>
          <div className="space-y-2">
            {laborItems.map((item, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={`${smallInput} w-28 shrink-0`}
                  value={item.label}
                  onChange={(e) => updateItem(laborItems, setLaborItems, i, { label: e.target.value })}
                  placeholder="조공비"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  className={smallInput}
                  value={item.amount}
                  onChange={(e) => updateItem(laborItems, setLaborItems, i, { amount: e.target.value })}
                  placeholder="0"
                />
                {laborItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLaborItems(laborItems.filter((_, idx) => idx !== i))}
                    aria-label="삭제"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLaborItems([...laborItems, { label: "조공비", amount: "" }])}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-50 text-[13px] font-semibold text-slate-500"
            >
              <Plus className="h-3.5 w-3.5" /> 인건비 항목 추가
            </button>
          </div>
        </div>

        <div>
          <span className={label}>밥값</span>
          <input
            type="number"
            inputMode="numeric"
            className={smallInput}
            value={mealCost}
            onChange={(e) => setMealCost(e.target.value)}
            placeholder="0"
          />
        </div>

        {/* 기름값 계산기 */}
        <div className="space-y-2.5 rounded-xl bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-600">
            <Fuel className="h-3.5 w-3.5" /> 기름값 계산기
          </p>
          <div className="flex gap-1.5">
            {(["diesel", "gasoline", "electric"] as VehicleType[]).map((vt) => (
              <button
                key={vt}
                type="button"
                onClick={() => setFuel((f) => ({ ...f, vehicleType: vt, fuelPrice: f.fuelPrice || String(DEFAULT_FUEL_PRICE[vt]) }))}
                className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold ${
                  fuel.vehicleType === vt ? "bg-indigo-600 text-white" : "bg-white text-slate-600"
                }`}
              >
                {VEHICLE_LABEL[vt]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">
                연비 ({EFFICIENCY_UNIT[fuel.vehicleType]})
              </span>
              <input
                type="number"
                inputMode="decimal"
                className={smallInput}
                value={fuel.efficiency}
                onChange={(e) => setFuel((f) => ({ ...f, efficiency: e.target.value }))}
                placeholder="예: 12"
              />
            </div>
            <div>
              <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">유가 ({FUEL_UNIT[fuel.vehicleType]})</span>
              <input
                type="number"
                inputMode="decimal"
                className={smallInput}
                value={fuel.fuelPrice}
                onChange={(e) => setFuel((f) => ({ ...f, fuelPrice: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">고객 거리 (편도 km)</span>
              <input
                type="number"
                inputMode="decimal"
                className={smallInput}
                value={customerDistance}
                onChange={(e) => setCustomerDistance(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">자재 구매 거리 (편도 km, 선택)</span>
              <input
                type="number"
                inputMode="decimal"
                className={smallInput}
                value={materialTripDistance}
                onChange={(e) => setMaterialTripDistance(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <p className="text-[11.5px] text-slate-500">
            왕복 거리 {roundTripKm.toFixed(1)}km (고객·자재 거리를 각각 왕복으로 계산해 더함) ÷ 연비 × 유가 = 자동 계산
          </p>
          <div>
            <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">기름값 (자동 계산 — 직접 고칠 수 있어요)</span>
            <input
              type="number"
              inputMode="numeric"
              className={smallInput}
              value={fuelCostOverride !== null ? fuelCostOverride : calculatedFuelCost ? String(Math.round(calculatedFuelCost)) : ""}
              onChange={(e) => setFuelCostOverride(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <div>
          <span className={label}>간식 등 기타 비용</span>
          <div className="space-y-2">
            {otherItems.map((item, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={`${smallInput} w-28 shrink-0`}
                  value={item.label}
                  onChange={(e) => updateItem(otherItems, setOtherItems, i, { label: e.target.value })}
                  placeholder="간식비"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  className={smallInput}
                  value={item.amount}
                  onChange={(e) => updateItem(otherItems, setOtherItems, i, { amount: e.target.value })}
                  placeholder="0"
                />
                {otherItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setOtherItems(otherItems.filter((_, idx) => idx !== i))}
                    aria-label="삭제"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setOtherItems([...otherItems, { label: "", amount: "" }])}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-50 text-[13px] font-semibold text-slate-500"
            >
              <Plus className="h-3.5 w-3.5" /> 기타 비용 항목 추가
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2.5">
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <p className="text-[12px] text-slate-500">수입</p>
          <p className="mt-1 text-[16px] font-extrabold tabular-nums text-emerald-600">{won(incomeTotal)}</p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <p className="text-[12px] text-slate-500">지출</p>
          <p className="mt-1 text-[16px] font-extrabold tabular-nums text-rose-600">{won(expenseTotal)}</p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <p className="text-[12px] text-slate-500">오늘 순이익</p>
          <p className={`mt-1 text-[16px] font-extrabold tabular-nums ${net >= 0 ? "text-slate-900" : "text-rose-600"}`}>{won(net)}</p>
        </div>
      </section>

      <button
        type="button"
        disabled={!canSave || saving}
        onClick={handleSave}
        className="flex h-14 w-full items-center justify-center rounded-2xl bg-indigo-600 text-[16px] font-bold text-white disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "가게부에 저장"}
      </button>
    </main>
  );
}
