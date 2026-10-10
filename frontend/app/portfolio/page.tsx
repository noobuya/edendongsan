"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BusinessBanner from "@/components/BusinessBanner";
import { listPortfolio } from "@/lib/api";
import type { PortfolioEntry } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

/** 서명 완료된 시공 건을 모아 보여주는 공개 쇼케이스. /blog와 달리 사장님이 글을
 *  따로 검수·발행하지 않고 서명만 끝나면 자동으로 올라온다 — 그래서 고객 이름 없이
 *  사진과 시공 항목 태그만 보여준다(portfolio.py 참고). */
export default function PortfolioPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [entries, setEntries] = useState<PortfolioEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPortfolio()
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : "포트폴리오를 불러오지 못했습니다."));
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 py-10 xs:px-6">
      <div className="mb-6">
        <BusinessBanner />
      </div>

      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">시공 갤러리</h1>
        <p className="mt-2 text-sm text-slate-500">완료된 시공 현장을 모아 보여드립니다</p>
      </header>

      {error && (
        <div className="mx-auto flex max-w-md items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && entries === null && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          불러오는 중...
        </div>
      )}

      {!error && entries !== null && entries.length === 0 && (
        <p className="py-16 text-center text-sm text-slate-400">아직 등록된 시공 사례가 없습니다</p>
      )}

      <div className="grid gap-4 xs:grid-cols-2 sm:grid-cols-3">
        {entries?.map((entry) => (
          <div
            key={entry.job_id}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="aspect-square w-full overflow-hidden bg-slate-100">
              {entry.after_image_url ? (
                <AssetImage src={entry.after_image_url} alt="시공 완료" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-300">이미지 없음</div>
              )}
            </div>
            <div className="space-y-1.5 p-3">
              {entry.item_tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entry.item_tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-400">{formatDate(entry.completed_at)}</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
