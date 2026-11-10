"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Trash2, Upload } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import {
  deleteSwatchScan,
  getSwatchScans,
  scanSwatchPages,
  swatchScanPhotoUrl,
  updateSwatchScan,
  type SwatchScanEntry,
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

const BRANDS = ["현대보닥", "KCC", "영림"];

/** 스캔된 품번 하나 — 사진·코드·이름을 보여주고, 코드를 못 읽었거나(needs_review)
 *  틀렸으면 바로 고칠 수 있다. */
function EntryRow({
  entry,
  token,
  onChanged,
  onRemoved,
}: {
  entry: SwatchScanEntry;
  token: string;
  onChanged: (updated: SwatchScanEntry) => void;
  onRemoved: (id: string) => void;
}) {
  const [code, setCode] = useState(entry.code);
  const [name, setName] = useState(entry.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = code !== entry.code || name !== entry.name;

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const all = await updateSwatchScan(entry.id, { code, name }, token);
      const updated = all.find((e) => e.id === entry.id);
      if (updated) onChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteSwatchScan(entry.id, token);
      onRemoved(entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "지우지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl p-3 ${entry.status === "needs_review" ? "bg-amber-50" : "bg-white"}`}>
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
        <AssetImage src={swatchScanPhotoUrl(entry.photo)} alt={entry.name || entry.code} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex gap-1.5">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="코드(예: S261)"
            className="h-9 w-28 rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-bold"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름(예: 딥 슬레이트)"
            className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[13px]"
          />
        </div>
        <p className="truncate text-[11px] text-slate-400">
          {entry.brand} · {entry.source}
          {entry.status === "needs_review" && " · 코드 확인 필요"}
        </p>
        {error && <p className="text-[11px] font-semibold text-rose-600">{error}</p>}
      </div>
      {dirty && (
        <button
          type="button"
          disabled={busy}
          onClick={handleSave}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white disabled:opacity-40"
          aria-label="저장"
        >
          {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Check className="h-4.5 w-4.5" strokeWidth={2.5} />}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={handleDelete}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-40"
        aria-label="지우기"
      >
        <Trash2 className="h-4.5 w-4.5" strokeWidth={2} />
      </button>
    </div>
  );
}

export default function AdminSwatchScanPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [entries, setEntries] = useState<SwatchScanEntry[]>([]);
  const [brand, setBrand] = useState(BRANDS[0]);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(t: string) {
    setBusy(true);
    setError(null);
    try {
      setEntries(await getSwatchScans());
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

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setScanning(true);
    setScanMsg(null);
    setError(null);
    try {
      const result = await scanSwatchPages(brand, files, token);
      setEntries(await getSwatchScans());
      const needsReview = result.found.filter((f) => f.status === "needs_review").length;
      setScanMsg(
        `${files.length}쪽에서 ${result.found.length}개 찾음(${needsReview}개는 코드 확인 필요)` +
          (result.errors.length ? ` · 실패 ${result.errors.length}쪽` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "스캔에 실패했습니다.");
    } finally {
      setScanning(false);
    }
  }

  const grouped = useMemo(() => {
    const filtered = reviewOnly ? entries.filter((e) => e.status === "needs_review") : entries;
    const byBrand = new Map<string, SwatchScanEntry[]>();
    for (const e of filtered) {
      const list = byBrand.get(e.brand) ?? [];
      list.push(e);
      byBrand.set(e.brand, list);
    }
    return [...byBrand.entries()];
  }, [entries, reviewOnly]);

  const needsReviewCount = entries.filter((e) => e.status === "needs_review").length;

  if (!authorized) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">견본 책자 스캔</h1>
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
        <h1 className="text-xl font-bold text-slate-900">견본 책자 스캔</h1>
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
        쪽 사진을 올리면 AI가 그 쪽 안의 품번 칩을 전부 찾아 자동으로 잘라 등록합니다. 책자 전체를 한 번에 올려도 됩니다
        (쪽마다 순서대로 처리돼서 시간이 걸릴 수 있어요).
      </p>

      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-slate-500">브랜드</p>
          <div className="flex gap-2">
            {BRANDS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBrand(b)}
                className={`h-10 flex-1 rounded-xl text-[13.5px] font-bold ${
                  brand === b ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handleScan} />
        <button
          type="button"
          disabled={scanning}
          onClick={() => fileRef.current?.click()}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
        >
          {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" strokeWidth={2} />}
          {scanning ? "스캔 중... (쪽 수에 따라 시간이 걸려요)" : `${brand} 쪽 사진 올려 스캔하기`}
        </button>
        {scanMsg && <p className="text-[13px] font-semibold text-indigo-700">{scanMsg}</p>}
        {error && <p className="text-[14px] font-semibold text-rose-700">{error}</p>}
      </section>

      <div className="flex items-center justify-between px-1">
        <p className="text-[13px] text-slate-500">
          총 {entries.length}개 {needsReviewCount > 0 && `(확인 필요 ${needsReviewCount}개)`}
        </p>
        <label className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          확인 필요만 보기
        </label>
      </div>

      {grouped.map(([brandName, list]) => (
        <section key={brandName} className="space-y-2">
          <p className="px-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-400">
            {brandName} ({list.length})
          </p>
          <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
            {list.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                token={token}
                onChanged={(updated) => setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))}
                onRemoved={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
              />
            ))}
          </div>
        </section>
      ))}
      {entries.length === 0 && <p className="py-10 text-center text-[14px] text-slate-400">아직 스캔한 견본이 없습니다</p>}
    </main>
  );
}
