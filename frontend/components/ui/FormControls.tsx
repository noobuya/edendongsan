"use client";

import type { LucideIcon } from "lucide-react";

// 입력 필드는 회색 면으로 칸을 그리지 않는다. 배경(유리 패널)에 그대로 얹힌 채
// 얇은 밑줄만 두고, 포커스가 오면 밑줄이 브랜드 색으로 살아난다 — 폼이 아니라
// 종이에 적는 느낌에 가깝게.
const FIELD_BASE =
  "w-full min-w-0 border-0 border-b border-slate-900/10 bg-transparent px-0 pb-3 pt-2 text-[17px] font-light text-slate-900 outline-none transition-colors placeholder:font-light placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0";

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function FormSection({ title, description, children }: SectionProps) {
  return (
    <div className="space-y-3.5">
      <div>
        <h3 className="text-[15px] font-bold tracking-tight text-slate-900">{title}</h3>
        {description && (
          <p className="mt-1.5 text-[13px] font-light leading-relaxed text-slate-500">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

interface OptionCardProps {
  label: string;
  sublabel?: string;
  selected: boolean;
  onClick: () => void;
  icon?: LucideIcon;
}

export function OptionCard({ label, sublabel, selected, onClick, icon: Icon }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative flex flex-1 items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-all duration-200 active:scale-[0.98] ${
        selected
          ? "bg-indigo-600 text-white shadow-[0_6px_24px_rgba(79,70,229,0.35)]"
          : "border border-slate-900/[0.06] bg-white/50 text-slate-600"
      }`}
    >
      {Icon && <Icon className={`h-5 w-5 shrink-0 ${selected ? "text-white" : "text-slate-400"}`} />}
      <span className="flex-1">
        <span className="block text-[15px] font-semibold leading-tight">{label}</span>
        {sublabel && (
          <span className={`mt-0.5 block text-xs font-light ${selected ? "text-indigo-100" : "text-slate-400"}`}>
            {sublabel}
          </span>
        )}
      </span>
    </button>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-center justify-between gap-4 border-b border-slate-900/[0.06] py-4 text-left"
    >
      <span>
        <span className="block text-[15px] font-semibold text-slate-900">{label}</span>
        {description && (
          <span className="mt-1 block text-[13px] font-light leading-relaxed text-slate-500">{description}</span>
        )}
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300 ${
          checked ? "bg-indigo-600 shadow-[0_4px_16px_rgba(79,70,229,0.4)]" : "bg-slate-900/10"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  onChange: (value: string) => void;
}

export function TextField({ label, value, placeholder, multiline, rows = 3, onChange }: TextFieldProps) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD_BASE} resize-y leading-relaxed`}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD_BASE}
        />
      )}
    </label>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  step?: number;
  onChange: (value: number) => void;
}

export function NumberField({ label, value, unit, min = 0, step = 1, onChange }: NumberFieldProps) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <div className="flex items-baseline gap-1.5 border-b border-slate-900/10 transition-colors focus-within:border-indigo-500">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          // 값이 0일 때 "0"을 그대로 표시하면, 그 뒤에 바로 숫자를 입력할 때
          // "0"이 지워지지 않고 "05"처럼 앞자리에 남는 문제가 생긴다 — 0일 때는
          // 빈 칸으로 보여주고(placeholder로 0 힌트만 주고) 그 외 값은 포커스 시
          // 전체 선택되게 해, 입력한 숫자가 항상 기존 값을 완전히 대체하게 한다.
          placeholder="0"
          value={Number.isFinite(value) && value !== 0 ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          onFocus={(e) => e.target.select()}
          className="w-full min-w-0 border-0 bg-transparent px-0 pb-3 pt-2 text-[17px] font-normal tabular-nums text-slate-900 outline-none placeholder:font-light placeholder:text-slate-300 focus:ring-0"
        />
        {unit && <span className="shrink-0 text-[13px] font-light text-slate-400">{unit}</span>}
      </div>
    </label>
  );
}
