"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Search, X } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import { listQuotes } from "@/lib/api";
import type { QuoteSummary } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (jobId: string) => void;
  /** 견적서 목록은 사장님 전용 자료라 토큰이 있어야 조회된다. */
  ownerToken: string;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function won(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export default function QuoteListDialog({ open, onClose, onSelect, ownerToken }: Props) {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuotes(null);
    setError(null);
    setQuery("");
    listQuotes(ownerToken)
      .then(setQuotes)
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기에 실패했습니다."));
  }, [open, ownerToken]);

  const filteredQuotes = useMemo(() => {
    if (!quotes) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return quotes;
    return quotes.filter((q) => q.customer_name.toLowerCase().includes(needle));
  }, [quotes, query]);

  if (!open) return null;

  return (
    /* 화면 아래에서 올라오는 바텀 시트 — 한 손으로 쥔 상태에서 엄지로 닿는 위치다.
       가로로 펼친 화면에서는 가운데 카드로 뜬다. */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm foldLandscape:items-center foldLandscape:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white pb-safe shadow-2xl foldLandscape:rounded-3xl foldLandscape:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 손잡이(grabber) — 아래로 쓸어내려 닫는 시트라는 신호 */}
        <div className="flex justify-center pt-3 foldLandscape:hidden">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <h3 className="text-[17px] font-bold tracking-tight text-slate-900">저장된 견적서</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {quotes !== null && quotes.length > 0 && (
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="고객명으로 검색"
                className="w-full min-w-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>
        )}

        <div className="overflow-y-auto">
          {error && <p className="p-5 text-sm text-red-600">{error}</p>}
          {!error && quotes === null && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              불러오는 중...
            </div>
          )}
          {!error && quotes !== null && quotes.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-400">저장된 견적서가 없습니다</p>
          )}
          {!error && filteredQuotes !== null && filteredQuotes.length === 0 && quotes!.length > 0 && (
            <p className="p-8 text-center text-sm text-slate-400">
              &quot;{query}&quot; 이름의 견적서를 찾지 못했습니다
            </p>
          )}
          {filteredQuotes?.map((q) => (
            <div
              key={q.job_id}
              className="flex w-full items-center gap-3 border-b border-slate-50 px-5 py-3 text-left transition-colors hover:bg-slate-50"
            >
              <button type="button" onClick={() => onSelect(q.job_id)} className="flex min-w-0 flex-1 items-center gap-3">
                {q.thumbnail_url ? (
                  <AssetImage
                    src={q.thumbnail_url}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{q.customer_name}</p>
                  <p className="text-xs text-slate-400">{formatDate(q.created_at)}</p>
                </div>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className="text-sm font-bold tabular-nums text-blue-600">{won(q.total_cost)}</p>
                {q.has_blog && (
                  <Link
                    href={`/blog/post?job=${q.job_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-0.5 text-[11px] font-medium text-slate-400 hover:text-blue-600"
                  >
                    블로그 <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
