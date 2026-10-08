"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2, Search, Users } from "lucide-react";
import BusinessBanner from "@/components/BusinessBanner";
import { listSharedEstimates } from "@/lib/api";
import type { SharedEstimate } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

function formatDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

function won(amount: number): string {
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

/** 견적 공유 커뮤니티 — 수강생들이 산출한 견적(품목·단가·총액)을 서로 참고하는 피드.
 *  고객 이름·현장 사진은 애초에 받지 않으므로 이 화면엔 그런 정보가 없다. */
export default function CommunityPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [estimates, setEstimates] = useState<SharedEstimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 목록 안에서 품목으로 한 번 더 좁혀 보는 칩. 검색어는 서버로 보내지만
  // 이건 이미 불러온 목록을 클라이언트에서만 추가로 거르는 거라 서버 호출이 없다.
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setError(null);
      listSharedEstimates(query)
        .then(setEstimates)
        .catch((err) => setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다."));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  // 지금 불러온 목록에 실제로 등장하는 품목만, 많이 나온 순서로 최대 10개 보여준다.
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of estimates ?? []) {
      for (const name of e.item_names) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name]) => name);
  }, [estimates]);

  const visibleEstimates = activeTag ? estimates?.filter((e) => e.item_names.includes(activeTag)) : estimates;

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 py-10 xs:px-6">
      <div className="mb-6">
        <BusinessBanner />
      </div>

      <header className="mb-8 text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-bold text-slate-900">
          <Users className="h-6 w-6 text-indigo-600" />
          견적 공유
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          수강생들이 올린 견적의 품목·단가를 참고하세요. 고객 정보는 올라오지 않습니다
        </p>
      </header>

      <div className="mx-auto mb-8 flex max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="작성자 이름 또는 품목으로 검색"
          className="w-full min-w-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
        />
      </div>

      {tags.length > 0 && (
        <div className="mx-auto mb-8 flex max-w-md flex-wrap justify-center gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag((cur) => (cur === tag ? null : tag))}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                activeTag === tag
                  ? "bg-indigo-600 text-white"
                  : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mx-auto flex max-w-md items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && estimates === null && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          불러오는 중...
        </div>
      )}

      {!error && estimates !== null && visibleEstimates?.length === 0 && (
        <p className="py-16 text-center text-sm text-slate-400">
          {activeTag
            ? `"${activeTag}" 품목이 들어간 견적이 없습니다`
            : query
              ? `"${query}"에 대한 견적을 찾지 못했습니다`
              : "아직 공유된 견적이 없습니다"}
        </p>
      )}

      <div className="grid gap-4 xs:grid-cols-2">
        {visibleEstimates?.map((e) => (
          <Link
            key={e.id}
            href={`/community/post?id=${e.id}`}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">{e.author}</span>
              <span className="text-xs text-slate-400">{formatDate(e.created)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {e.item_names.map((name) => (
                <span key={name} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                  {name}
                </span>
              ))}
            </div>
            {e.note && <p className="line-clamp-2 text-xs text-slate-500">{e.note}</p>}
            <p className="text-right text-lg font-bold tabular-nums text-indigo-600">{won(e.total_cost)}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
