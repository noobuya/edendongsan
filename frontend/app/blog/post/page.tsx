"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BusinessBanner from "@/components/BusinessBanner";
import CallBanner from "@/components/CallBanner";
import { getBlogDetail } from "@/lib/api";
import type { BlogDetail, WorkPhoto, WorkPhotoStage } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

const STAGE_LABEL: Record<WorkPhotoStage, string> = {
  before: "🔧 시공 전",
  progress: "🛠️ 작업 중",
  after: "✨ 시공 후",
};

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export default function BlogDetailPage() {
  const router = useRouter();
  // 안드로이드 뒤로 가기로 앱이 꺼지지 않고 앞 화면으로 돌아가게 한다.
  useAndroidBack(() => {
    router.back();
    return true;
  });

  // useSearchParams() 훅 대신 window.location을 직접 읽는다 — Capacitor용
  // 정적 내보내기(output: 'export')에서는 동적 경로 세그먼트([jobId])를 빌드
  // 시점에 미리 알 수 없어 쓸 수 없고, 대신 쿼리스트링(?job=...)으로 다뤄야
  // 한다. useSearchParams()를 쓰면 Suspense 경계가 필요해지는데, app/page.tsx가
  // 이미 쓰고 있는 이 방식(useEffect에서 window.location.search 직접 파싱)이
  // 정적 내보내기와도 호환되고 이 프로젝트의 기존 컨벤션과도 일치한다.
  const [jobId, setJobId] = useState<string | null>(null);
  const [post, setPost] = useState<BlogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    setJobId(id);
    if (!id) {
      setError("잘못된 주소입니다.");
      return;
    }
    setPost(null);
    setError(null);
    getBlogDetail(id)
      .then(setPost)
      .catch((err) => setError(err instanceof Error ? err.message : "글을 불러오지 못했습니다."));
  }, []);

  if (error) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-4 py-16 xs:px-6">
        <Link href="/blog" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
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

  if (!jobId || !post) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        불러오는 중...
      </main>
    );
  }

  const groupedPhotos: Record<WorkPhotoStage, WorkPhoto[]> = {
    before: post.work_photos.filter((p) => p.stage === "before"),
    progress: post.work_photos.filter((p) => p.stage === "progress"),
    after: post.work_photos.filter((p) => p.stage === "after"),
  };
  // 시공 전/후를 같은 순서로 짝지어 나란히 보여준다 — 변화가 한눈에 들어오는
  // "before/after" 비교가 문단 사이에 흩어진 사진 나열보다 훨씬 설득력 있다.
  const pairCount = Math.min(groupedPhotos.before.length, groupedPhotos.after.length);
  const pairs = Array.from({ length: pairCount }, (_, i) => ({
    before: groupedPhotos.before[i],
    after: groupedPhotos.after[i],
  }));
  const leftoverBefore = groupedPhotos.before.slice(pairCount);
  const leftoverAfter = groupedPhotos.after.slice(pairCount);

  const coverUrl =
    groupedPhotos.after[0]?.url ?? post.after_image_url ?? post.before_image_url ?? undefined;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10 xs:px-6">
      <div className="mb-6">
        <BusinessBanner />
      </div>

      {/* 삭제는 사장님 기기의 결과 화면(작업사진 패널)에서만 한다 — 이 페이지는
          누구나 열 수 있는 공개 페이지라 삭제 버튼을 두지 않는다. */}
      <div className="mb-6">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
      </div>

      <article>
        <header className="mb-6 space-y-2">
          <h1 className="text-2xl font-bold leading-snug text-slate-900">{post.title}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400">
            <span>{post.customer_name} 고객님</span>
            <span>·</span>
            <span>{formatDate(post.created_at)}</span>
            {post.line_item_names.length > 0 && (
              <>
                <span>·</span>
                <span>{post.line_item_names.join(", ")}</span>
              </>
            )}
          </div>
        </header>

        {coverUrl && (
          <AssetImage
            src={coverUrl}
            alt={post.title}
            className="mb-6 aspect-[4/3] w-full rounded-xl object-cover shadow-sm"
          />
        )}

        <div className="mb-8">
          <CallBanner />
        </div>

        <div className="space-y-4 text-[15px] leading-relaxed text-slate-700">
          {post.content
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, i) => (
              <p key={i} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
        </div>

        {pairs.length > 0 && (
          <section className="mt-8 space-y-6">
            {pairs.map((pair, i) => (
              <div key={pair.before.id + pair.after.id}>
                <p className="mb-2 text-center text-xs tracking-wide text-slate-400">
                  🔨 〔시공전〕···········〔시공후〕 ✨
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <AssetImage
                    src={pair.before.url}
                    alt={`시공 전 사진 ${i + 1}`}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                  <AssetImage
                    src={pair.after.url}
                    alt={`시공 후 사진 ${i + 1}`}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                </div>
              </div>
            ))}
          </section>
        )}

        {([
          ["before", leftoverBefore],
          ["progress", groupedPhotos.progress],
          ["after", leftoverAfter],
        ] as const).map(
          ([stage, photos]) =>
            photos.length > 0 && (
              <section key={stage} className="mt-8">
                <h2 className="mb-3 text-sm font-semibold text-slate-800">{STAGE_LABEL[stage]} 사진</h2>
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo) => (
                    <AssetImage
                      key={photo.id}
                      src={photo.url}
                      alt={`${STAGE_LABEL[stage]} 사진`}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  ))}
                </div>
              </section>
            )
        )}

        <div className="mt-8">
          <CallBanner />
        </div>
      </article>
    </main>
  );
}
