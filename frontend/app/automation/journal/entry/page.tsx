"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ImagePlus, Loader2, Pencil, Trash2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import {
  deleteJournalEntry,
  deleteJournalPhoto,
  getJournalEntry,
  updateJournalEntry,
  uploadJournalPhoto,
} from "@/lib/api";
import type { JournalEntry } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

const CODE_KEY = "eden-automation-code";

function readCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

function formatDate(sec: number): string {
  return new Date(sec * 1000).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 일지 한 건 — 상세·수정·사진·삭제. 쿼리스트링(?id=)으로 다루는 이유는
 *  app/blog/post/page.tsx와 같다(Capacitor 정적 내보내기는 동적 경로를 못 쓴다). */
export default function JournalEntryPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [code] = useState(() => readCode());
  const [id, setId] = useState<string | null>(null);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("id");
    setId(value);
    if (!code) {
      setError("먼저 [내 작업 일지]에서 수강생 코드로 들어가 주세요.");
      return;
    }
    if (!value) {
      setError("잘못된 주소입니다.");
      return;
    }
    getJournalEntry(code, value)
      .then((e) => {
        setEntry(e);
        setTitle(e.title);
        setContent(e.content);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "일지를 불러오지 못했습니다."));
  }, [code]);

  async function saveEdit() {
    if (!id || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateJournalEntry(code, id, title.trim(), content.trim());
      setEntry(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEntry() {
    if (!id) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    try {
      await deleteJournalEntry(code, id);
      router.push("/automation/journal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다.");
      setConfirmingDelete(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadJournalPhoto(code, id, file, "");
      setEntry(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진 업로드에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePhoto(photoId: string) {
    if (!id || !entry) return;
    setEntry({ ...entry, photos: entry.photos.filter((p) => p.id !== photoId) });
    try {
      await deleteJournalPhoto(code, id, photoId);
    } catch {
      // 무시 — 다음 조회 시 서버 상태로 다시 맞춰진다.
    }
  }

  if (error) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-4 py-16 xs:px-6">
        <Link href="/automation/journal" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      </main>
    );
  }

  if (!entry) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        불러오는 중...
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10 xs:px-6">
      <div className="mb-6 flex items-center justify-between gap-2">
        <Link href="/automation/journal" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
        <div className="flex items-center gap-3">
          {!editing && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-indigo-600">
              <Pencil className="h-3.5 w-3.5" />
              수정
            </button>
          )}
          <button
            onClick={handleDeleteEntry}
            className={`flex items-center gap-1 text-xs font-medium ${confirmingDelete ? "text-red-600" : "text-slate-400 hover:text-red-500"}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {confirmingDelete ? "한 번 더 누르면 삭제" : "삭제"}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-[17px] font-bold text-slate-900 outline-none focus:border-indigo-600"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            maxLength={4000}
            className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-[14px] leading-relaxed text-slate-900 outline-none focus:border-indigo-600"
          />
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="h-11 flex-1 rounded-xl bg-slate-100 text-[14px] font-semibold text-slate-700">
              취소
            </button>
            <button disabled={busy} onClick={saveEdit} className="flex h-11 flex-[2] items-center justify-center rounded-xl bg-indigo-600 text-[14px] font-bold text-white disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
            </button>
          </div>
        </div>
      ) : (
        <article className="space-y-4">
          <header>
            <h1 className="text-[22px] font-bold leading-snug text-slate-900">{entry.title}</h1>
            <p className="mt-1 text-[13px] text-slate-400">{formatDate(entry.created)}</p>
          </header>
          {entry.content && <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{entry.content}</p>}
        </article>
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">사진</h2>
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1 text-[13px] font-semibold text-indigo-600 disabled:opacity-40">
            <ImagePlus className="h-4 w-4" />
            추가
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>
        {entry.photos.length === 0 ? (
          <p className="text-[13px] text-slate-400">아직 올린 사진이 없어요.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {entry.photos.map((p) => (
              <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                <AssetImage src={p.url} alt="" className="h-full w-full object-cover" />
                <button
                  onClick={() => handleDeletePhoto(p.id)}
                  className="absolute right-1 top-1 hidden rounded bg-black/60 p-1 text-white group-hover:block"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
