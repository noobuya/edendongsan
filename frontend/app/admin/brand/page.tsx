"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import { getBrandAssets, uploadBrandImage, type BrandAssets } from "@/lib/api";

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

const KINDS: { kind: "logo" | "card" | "hero"; label: string; hint: string }[] = [
  { kind: "hero", label: "대표 사진", hint: "앱 첫 화면·견적 화면 맨 위에 크게 보여요. 가로형 사진이 잘 어울립니다" },
  { kind: "logo", label: "로고", hint: "정사각형에 가까운 사진이 잘 어울립니다" },
  { kind: "card", label: "명함", hint: "가로로 긴 사진이 잘 어울립니다" },
];

function UploadCard({
  kind,
  label,
  hint,
  current,
  token,
  onUploaded,
}: {
  kind: "logo" | "card" | "hero";
  label: string;
  hint: string;
  current: string | null;
  token: string;
  onUploaded: (assets: BrandAssets) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
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

  return (
    <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-[15px] font-bold text-slate-800">{label}</h2>
      <p className="text-[13px] text-slate-500">{hint}</p>

      <div className="flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-xl bg-slate-50">
        {current ? (
          <AssetImage src={current} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span className="text-[13px] text-slate-400">아직 올린 사진이 없어요</span>
        )}
      </div>

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
        {current ? `${label} 바꾸기` : `${label} 올리기`}
      </button>
      {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
    </section>
  );
}

export default function AdminBrandPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [assets, setAssets] = useState<BrandAssets>({ logo: null, card: null, hero: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(t: string) {
    setBusy(true);
    setError(null);
    try {
      setAssets(await getBrandAssets());
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
        <h1 className="text-xl font-bold text-slate-900">로고·명함·대표 사진 관리</h1>
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
        <h1 className="text-xl font-bold text-slate-900">로고·명함·대표 사진 관리</h1>
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
        여기서 올린 사진은 블로그 메인과 앱 첫 화면에 바로 반영됩니다.
      </p>

      {KINDS.map(({ kind, label, hint }) => (
        <UploadCard
          key={kind}
          kind={kind}
          label={label}
          hint={hint}
          current={assets[kind]}
          token={token}
          onUploaded={setAssets}
        />
      ))}
    </main>
  );
}
