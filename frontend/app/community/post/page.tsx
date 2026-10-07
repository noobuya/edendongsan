"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2, Trash2 } from "lucide-react";
import BusinessBanner from "@/components/BusinessBanner";
import { deleteSharedEstimate, getSharedEstimate } from "@/lib/api";
import { readOwnerToken } from "@/lib/ownerToken";
import type { SharedEstimate } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

function formatDate(sec: number): string {
  return new Date(sec * 1000).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function won(amount: number): string {
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

export default function CommunityEstimatePage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  // 정적 내보내기 호환을 위해 동적 경로 대신 쿼리스트링(?id=)을 쓴다 — app/blog/post/page.tsx와 같은 이유.
  const [id, setId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<SharedEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownerToken] = useState(() => readOwnerToken());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("id");
    setId(value);
    if (!value) {
      setError("잘못된 주소입니다.");
      return;
    }
    setEstimate(null);
    setError(null);
    getSharedEstimate(value)
      .then(setEstimate)
      .catch((err) => setError(err instanceof Error ? err.message : "견적을 불러오지 못했습니다."));
  }, []);

  async function handleDelete() {
    if (!id || !ownerToken) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteSharedEstimate(id, ownerToken);
      router.push("/community");
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-4 py-16 xs:px-6">
        <Link href="/community" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
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

  if (!id || !estimate) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        불러오는 중...
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10 xs:px-6">
      <div className="mb-6">
        <BusinessBanner />
      </div>

      <div className="mb-6 flex items-center justify-between gap-2">
        <Link href="/community" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
        {/* 삭제는 모더레이션용으로 사장님 기기에서만 보인다. */}
        {ownerToken && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={`flex items-center gap-1 text-xs font-medium disabled:opacity-50 ${
              confirmingDelete ? "text-red-600" : "text-slate-400 hover:text-red-500"
            }`}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {deleting ? "삭제 중..." : confirmingDelete ? "한 번 더 누르면 삭제" : "삭제"}
          </button>
        )}
      </div>

      <article className="space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm text-slate-500">
            <span className="font-semibold text-slate-900">{estimate.author}</span>
            <span>{formatDate(estimate.created)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {estimate.item_names.map((name) => (
              <span key={name} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                {name}
              </span>
            ))}
          </div>
          {estimate.note && (
            <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{estimate.note}</p>
          )}
        </header>

        <div className="space-y-3">
          {estimate.line_items.map((li) => (
            <div key={li.item_id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{li.item_name}</p>
                <p className="text-sm font-bold tabular-nums text-slate-900">{won(li.subtotal)}</p>
              </div>
              <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                {li.details.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="min-w-0 truncate">
                      {d.label}
                      {d.spec && <span className="text-slate-400"> · {d.spec}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {d.quantity}
                      {d.unit} × {won(d.unit_price)} = {won(d.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-indigo-50 p-4 text-right">
          <p className="text-xs font-medium text-indigo-500">총액</p>
          <p className="text-2xl font-bold tabular-nums text-indigo-700">{won(estimate.total_cost)}</p>
        </div>
      </article>
    </main>
  );
}
