"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import { deleteSwatchPhoto, getSwatchPhotos, uploadSwatchPhoto } from "@/lib/api";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";

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

/** 품번 하나의 실물 견본 사진 업로드 카드 — 찍어서 바로 올리고(카메라),
 *  잘못 찍었으면 지우고 다시 올릴 수 있다. */
function SwatchRow({
  swatch,
  photoUrl,
  token,
  onChanged,
}: {
  swatch: { id: string; name: string; colorHex: string; brand?: string; code?: string };
  photoUrl: string | null;
  token: string;
  onChanged: (photos: Record<string, string>) => void;
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
      onChanged(await uploadSwatchPhoto(swatch.id, file, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진을 올리지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await deleteSwatchPhoto(swatch.id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진을 지우지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white p-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg">
        {photoUrl ? (
          <AssetImage src={photoUrl} alt={swatch.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: swatch.colorHex }} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-bold text-slate-800">{swatch.name}</p>
        <p className="text-[11.5px] text-slate-400">
          {swatch.brand ? `${swatch.brand}${swatch.code ? ` · ${swatch.code}` : ""}` : "기본 색상"}
          {!photoUrl && " · 근사 색(실물 사진 없음)"}
        </p>
        {error && <p className="text-[11.5px] font-semibold text-rose-600">{error}</p>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white disabled:opacity-40"
        aria-label="사진 찍어 올리기"
      >
        {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Camera className="h-4.5 w-4.5" strokeWidth={2} />}
      </button>
      {photoUrl && (
        <button
          type="button"
          disabled={busy}
          onClick={handleDelete}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-40"
          aria-label="사진 지우기"
        >
          <Trash2 className="h-4.5 w-4.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

export default function AdminSwatchesPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(t: string) {
    setBusy(true);
    setError(null);
    try {
      const p = await getSwatchPhotos();
      setPhotos(p);
      setToken(t);
      setAuthorized(true);
      writeToken(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const saved = readToken();
    if (saved) void load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = Object.keys(photos).length;
  const total = ALL_PATTERN_SWATCHES.length;

  if (!authorized) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">실물 견본 사진 관리</h1>
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
        <h1 className="text-xl font-bold text-slate-900">실물 견본 사진 관리</h1>
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
        품번마다 실제 샘플북을 찍어 올리면, 색상 상담(/colors) 화면에서 근사 색 대신 이 사진을 그대로 보여줍니다.
        {" "}카메라 버튼을 누르면 바로 찍어 올릴 수 있어요. ({done}/{total}곳 완료)
      </p>

      <section className="space-y-2 rounded-2xl bg-slate-50 p-3">
        {ALL_PATTERN_SWATCHES.map((swatch) => (
          <SwatchRow key={swatch.id} swatch={swatch} photoUrl={photos[swatch.id] ?? null} token={token} onChanged={setPhotos} />
        ))}
      </section>
    </main>
  );
}
