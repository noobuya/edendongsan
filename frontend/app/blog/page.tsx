"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2, Search } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BusinessBanner from "@/components/BusinessBanner";
import { listBlogPosts } from "@/lib/api";
import type { BlogSummary } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export default function BlogListPage() {
  const router = useRouter();
  // 안드로이드 뒤로 가기로 앱이 꺼지지 않고 앞 화면으로 돌아가게 한다.
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [posts, setPosts] = useState<BlogSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      setError(null);
      listBlogPosts(query)
        .then(setPosts)
        .catch((err) => setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다."));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 py-10 xs:px-6">
      <div className="mb-6">
        <BusinessBanner />
      </div>

      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">시공 후기 블로그</h1>
        <p className="mt-2 text-sm text-slate-500">
          실제로 진행한 인테리어 시공 현장을 사진과 함께 기록합니다
        </p>
      </header>

      <div className="mx-auto mb-8 flex max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="고객명 또는 제목으로 검색"
          className="w-full min-w-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
        />
      </div>

      {error && (
        <div className="mx-auto flex max-w-md items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && posts === null && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          불러오는 중...
        </div>
      )}

      {!error && posts !== null && posts.length === 0 && (
        <p className="py-16 text-center text-sm text-slate-400">
          {query ? `"${query}"에 대한 시공 후기를 찾지 못했습니다` : "아직 등록된 시공 후기가 없습니다"}
        </p>
      )}

      <div className="grid gap-4 xs:grid-cols-2">
        {posts?.map((post) => (
          <Link
            key={post.job_id}
            href={`/blog/post?job=${post.job_id}`}
            className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
              {post.cover_image_url ? (
                <AssetImage
                  src={post.cover_image_url}
                  alt={post.title}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-300">
                  이미지 없음
                </div>
              )}
            </div>
            {/* 삭제는 사장님 기기의 결과 화면(작업사진 패널)에서만 한다 — 이 페이지는
                누구나 열 수 있는 공개 페이지라 삭제 버튼을 두지 않는다. */}
            <div className="space-y-1.5 p-4">
              <p className="line-clamp-2 text-sm font-semibold text-slate-900">{post.title}</p>
              <p className="line-clamp-2 text-xs text-slate-500">{post.excerpt}</p>
              <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
                <span>{post.customer_name} 고객님</span>
                <span>{formatDate(post.created_at)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
