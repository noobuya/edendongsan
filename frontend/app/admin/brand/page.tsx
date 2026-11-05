"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import {
  generateHeroImage,
  getBrandAssets,
  getBusinessInfo,
  saveBusinessInfo,
  uploadBrandImage,
  type BrandAssets,
  type BusinessInfo,
} from "@/lib/api";

const TOKEN_KEY = "eden-admin-token";

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeToken(value: string) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 저장이 막혀 있어도 이 화면에서는 계속 쓸 수 있다. */
  }
}

const input =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500";
const label = "mb-1.5 block text-[12.5px] font-semibold text-slate-500";

const KINDS: { kind: "logo" | "card" | "hero"; label: string; hint: string }[] = [
  { kind: "hero", label: "대표 사진", hint: "앱 첫 화면·견적 화면 맨 위에 크게 보여요. 가로형 사진이 잘 어울립니다" },
  { kind: "logo", label: "로고", hint: "정사각형에 가까운 사진이 잘 어울립니다" },
  { kind: "card", label: "명함", hint: "가로로 긴 사진이 잘 어울립니다" },
];

/** 업체 정보(상호명·전화번호 등) 편집 카드. 저장하면 블로그 서명·배너·영수증 등
 *  이 값을 쓰는 모든 곳에 바로 반영된다(app/business_info.py가 override로 저장). */
function BusinessInfoCard({
  info,
  token,
  onSaved,
  onNameChanged,
}: {
  info: BusinessInfo;
  token: string;
  onSaved: (info: BusinessInfo) => void;
  /** 상호명이 실제로 바뀌었을 때만 호출 — 대표 사진도 새로 만들라는 안내에 쓴다. */
  onNameChanged: () => void;
}) {
  const [form, setForm] = useState(info);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => setForm(info), [info]);

  const changed =
    form.business_name !== info.business_name ||
    form.phone !== info.phone ||
    form.representative_name !== info.representative_name ||
    form.service_area !== info.service_area ||
    form.service_area_short !== info.service_area_short;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedAt(false);
    try {
      const nameChanged = form.business_name.trim() !== info.business_name;
      const updated = await saveBusinessInfo(form, token);
      onSaved(updated);
      setSavedAt(true);
      if (nameChanged) onNameChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-[15px] font-bold text-slate-800">업체 정보</h2>
        <p className="text-[13px] text-slate-500">
          여기서 바꾼 상호명·전화번호는 블로그 서명·배너·영수증 등 모든 곳에 바로 반영돼요.
        </p>
      </div>

      <div>
        <span className={label}>상호명</span>
        <input
          className={input}
          value={form.business_name}
          onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
        />
      </div>
      <div>
        <span className={label}>전화번호</span>
        <input
          className={input}
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </div>
      <div>
        <span className={label}>대표자명 (선택)</span>
        <input
          className={input}
          value={form.representative_name}
          onChange={(e) => setForm((f) => ({ ...f, representative_name: e.target.value }))}
        />
      </div>
      <div>
        <span className={label}>출장 지역 문구</span>
        <input
          className={input}
          value={form.service_area}
          onChange={(e) => setForm((f) => ({ ...f, service_area: e.target.value }))}
        />
      </div>
      <div>
        <span className={label}>출장 지역 (짧게 — 블로그 제목 등에 쓰여요)</span>
        <input
          className={input}
          value={form.service_area_short}
          onChange={(e) => setForm((f) => ({ ...f, service_area_short: e.target.value }))}
        />
      </div>

      <button
        type="button"
        disabled={saving || !changed}
        onClick={handleSave}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : changed ? "업체 정보 저장" : "변경 사항 없음"}
      </button>
      {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
      {savedAt && !error && <p className="text-center text-[13px] font-medium text-green-600">저장했습니다</p>}
    </section>
  );
}

function UploadCard({
  kind,
  label: cardLabel,
  hint,
  current,
  token,
  onUploaded,
  reminder,
}: {
  kind: "logo" | "card" | "hero";
  label: string;
  hint: string;
  current: string | null;
  token: string;
  onUploaded: (assets: BrandAssets) => void;
  /** hero 카드에서만 쓴다 — 상호명을 막 바꾼 직후, 사진도 새로 만들라고 알려준다. */
  reminder?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadBrandImage(kind, file, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진을 올리지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      onUploaded(await generateHeroImage(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 배경화면을 만들지 못했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-[15px] font-bold text-slate-800">{cardLabel}</h2>
      <p className="text-[13px] text-slate-500">{hint}</p>

      {reminder && (
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-800">
          상호명을 바꾸셨어요 — 대표 사진도 새로 만들어 주세요.
        </p>
      )}

      <div className="flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-xl bg-slate-50">
        {current ? (
          <AssetImage src={current} alt={cardLabel} className="h-full w-full object-contain" />
        ) : (
          <span className="text-[13px] text-slate-400">아직 올린 사진이 없어요</span>
        )}
      </div>

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={busy || generating}
        onClick={() => inputRef.current?.click()}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
        {current ? `${cardLabel} 바꾸기` : `${cardLabel} 올리기`}
      </button>

      {kind === "hero" && (
        <button
          type="button"
          disabled={busy || generating}
          onClick={handleGenerate}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[15px] font-bold text-white disabled:opacity-40"
        >
          {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          {generating ? "AI가 만드는 중... (최대 1분)" : "AI로 배경화면 새로 만들기"}
        </button>
      )}
      {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
    </section>
  );
}

export default function AdminBrandPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [assets, setAssets] = useState<BrandAssets>({ logo: null, card: null, hero: null });
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);
  const [heroReminder, setHeroReminder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(t: string) {
    setBusy(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([getBrandAssets(), getBusinessInfo()]);
      setAssets(a);
      setBusinessInfo(b);
      setToken(t);
      setAuthorized(true);
      writeToken(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  // 같은 탭에서 새로고침해도 토큰을 다시 묻지 않도록 한다. 로고·명함 조회는 공개
  // 핑이라 여기서는 토큰이 맞는지 확인하지 못한다 — 틀린 토큰이면 올릴 때 알게 된다.
  useEffect(() => {
    const saved = readToken();
    if (saved) void load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authorized) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">업체 정보·대표 사진 관리</h1>
        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[14px] text-slate-600">서버에 설정된 관리자 토큰을 입력하세요.</p>
          <input
            type="password"
            className={input}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="관리자 토큰"
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && tokenInput && load(tokenInput.trim())}
          />
          <button
            disabled={busy || !tokenInput.trim()}
            onClick={() => load(tokenInput.trim())}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "들어가기"}
          </button>
          {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">업체 정보·대표 사진 관리</h1>
        <button
          onClick={() => {
            writeToken("");
            setAuthorized(false);
            setToken("");
          }}
          className="text-[14px] text-slate-500 underline"
        >
          나가기
        </button>
      </header>
      <p className="px-1 text-[13px] text-slate-500">
        여기서 바꾼 정보·사진은 블로그 메인과 앱 첫 화면에 바로 반영됩니다.
      </p>

      {businessInfo && (
        <BusinessInfoCard
          info={businessInfo}
          token={token}
          onSaved={setBusinessInfo}
          onNameChanged={() => setHeroReminder(true)}
        />
      )}

      {KINDS.map(({ kind, label: cardLabel, hint }) => (
        <UploadCard
          key={kind}
          kind={kind}
          label={cardLabel}
          hint={hint}
          current={assets[kind]}
          token={token}
          onUploaded={(a) => {
            setAssets(a);
            if (kind === "hero") setHeroReminder(false);
          }}
          reminder={kind === "hero" && heroReminder}
        />
      ))}
    </main>
  );
}
