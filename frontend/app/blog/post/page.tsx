"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Film, Loader2, RefreshCw } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import BusinessBanner from "@/components/BusinessBanner";
import CallBanner from "@/components/CallBanner";
import ShareLinkButton from "@/components/ShareLinkButton";
import CopyToNaverButton from "@/components/blog/CopyToNaverButton";
import { readOwnerToken } from "@/lib/ownerToken";
import { createBlogVideo, generateBlogPost, getBlogDetail, resolveAssetUrl } from "@/lib/api";
import { pairsAfterSection, parseBlogSections, planBlogPhotos } from "@/lib/blogBlocks";
import type { BlogDetail, WorkPhotoStage } from "@/types";
import { splitBoldSegments } from "@/lib/richText";
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
  // 네이버 블로그용 전체 복사는 사장님 기기에서만 — 손님이 보는 공개 페이지라서다.
  const [isOwner, setIsOwner] = useState(false);
  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState(false);

  useEffect(() => {
    const token = readOwnerToken();
    setOwnerToken(token);
    setIsOwner(!!token);
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

  // 사진으로 만든 블로그는 영상이 서버에서 따로 준비된다 — 준비 중이면 10초마다 다시 본다.
  useEffect(() => {
    if (!jobId || post?.video_url || post?.video_status !== "processing") return;
    const id = window.setInterval(() => {
      getBlogDetail(jobId)
        .then((fresh) => {
          if (fresh.video_url || fresh.video_status !== "processing") setPost(fresh);
        })
        .catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [jobId, post?.video_url, post?.video_status]);

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

  // [2026-11-03 재구성 — "사진과 큰 문구, 영상으로 압도하게 / 시공 전후 칸을 바꿔서"]
  // 예전엔 글을 다 쓴 뒤 맨 아래에 작은 정사각형 사진을 2~3열로 몰아 붙였다. 지금은
  // 영상 → 큰 문구 블록마다 뒤에 "좌우로 밀어 보는" 큰 비교 사진 → 남은 사진도 크게.
  // 배치 규칙은 네이버 옮기기 순서표와 같은 lib/blogBlocks.ts를 쓴다 — 앱에서 본
  // 순서 그대로 네이버에 옮겨진다.
  const sections = parseBlogSections(post.content);
  const { pairs, rest } = planBlogPhotos(post.work_photos);
  const afterPhotos = post.work_photos.filter((p) => p.stage === "after");
  // AI 합성 사진(after_image_url)은 실제 시공 결과가 아니므로 대표 사진 후보에서 뺀다.
  const coverUrl = afterPhotos[0]?.url ?? post.work_photos[0]?.url ?? post.before_image_url ?? undefined;

  async function handleRewrite() {
    if (!ownerToken || !jobId) return;
    if (!window.confirm("AI가 사진을 보고 글을 새로 써요. 지금 글은 바뀝니다. 계속할까요?")) return;
    setRewriting(true);
    try {
      const fresh = await generateBlogPost(jobId, ownerToken);
      setPost((prev) => (prev ? { ...prev, title: fresh.title, content: fresh.content, hashtags: fresh.hashtags } : prev));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "글을 다시 쓰지 못했습니다.");
    } finally {
      setRewriting(false);
    }
  }

  async function handleMakeVideo() {
    if (!ownerToken || !jobId) return;
    setVideoBusy(true);
    setVideoError(null);
    try {
      const url = await createBlogVideo(jobId, ownerToken);
      // 같은 주소로 다시 만들면 브라우저가 예전 영상을 보여 주지 않도록 꼬리표를 붙인다.
      setPost((prev) => (prev ? { ...prev, video_url: `${url}?v=${Date.now()}` } : prev));
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "영상을 만들지 못했습니다.");
    } finally {
      setVideoBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10 xs:px-6">
      <div className="mb-6">
        <BusinessBanner />
      </div>

      {/* 삭제는 사장님 기기의 결과 화면(작업사진 패널)에서만 한다 — 이 페이지는
          누구나 열 수 있는 공개 페이지라 삭제 버튼을 두지 않는다. */}
      <div className="mb-6 flex items-center justify-between gap-2">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
        <ShareLinkButton url={typeof window !== "undefined" ? window.location.href : ""} title={post.title} />
      </div>

      {isOwner && (
        <div className="mb-6 space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleMakeVideo}
              disabled={videoBusy}
              className="flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-60"
            >
              {videoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
              {videoBusy ? "영상 만드는 중… (최대 1분)" : post.video_url ? "시공 영상 다시 만들기" : "시공 영상 만들기"}
            </button>
            <button
              type="button"
              onClick={handleRewrite}
              disabled={rewriting}
              className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 transition active:scale-95 disabled:opacity-60"
            >
              {rewriting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {rewriting ? "글 쓰는 중… (1분 안팎)" : "글 다시 쓰기"}
            </button>
            {videoError && <span className="text-xs text-red-600">{videoError}</span>}
            {!post.video_url && post.video_status === "processing" && (
              <span className="text-xs text-slate-500">영상을 준비하고 있어요(1~3분) — 다 되면 자동으로 나타나요</span>
            )}
            {!post.video_url && post.video_status === "failed" && (
              <span className="text-xs text-red-600">영상 준비에 실패했어요 — &apos;시공 영상 만들기&apos;로 사진 영상을 만들 수 있어요</span>
            )}
          </div>
          <CopyToNaverButton
            post={{
              title: post.title,
              content: post.content,
              hashtags: post.hashtags ?? [],
              coverUrl,
              photos: post.work_photos,
              videoUrl: post.video_url,
              jobId: jobId ?? undefined,
            }}
          />
        </div>
      )}

      <article>
        <header className="mb-6 space-y-3 text-center">
          <h1 className="text-[26px] font-black leading-snug tracking-tight text-slate-900 xs:text-3xl">{post.title}</h1>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-slate-400">
            <span>{formatDate(post.created_at)}</span>
            {post.line_item_names.length > 0 && (
              <>
                <span>·</span>
                <span>{post.line_item_names.join(", ")}</span>
              </>
            )}
          </div>
        </header>

        {post.video_url ? (
          <video
            src={resolveAssetUrl(post.video_url)}
            autoPlay
            muted
            loop
            playsInline
            controls
            className="mb-8 aspect-[4/5] w-full rounded-2xl bg-black object-cover shadow-lg"
          />
        ) : (
          coverUrl && (
            <AssetImage
              src={coverUrl}
              alt={post.title}
              className="mb-8 h-auto min-h-[240px] w-full rounded-2xl shadow-lg"
            />
          )
        )}

        <div className="mb-10">
          <CallBanner />
        </div>

        <div className="space-y-12">
          {sections.map((sec, i) => (
            <section key={i} className="space-y-6">
              <div className="space-y-3 text-center">
                {sec.headline && (
                  <h2 className="text-[24px] font-black leading-snug tracking-tight text-slate-900 xs:text-[28px]">
                    {sec.headline}
                  </h2>
                )}
                {sec.paragraphs.map((paragraph, j) => (
                  <p key={j} className="whitespace-pre-line text-[17px] leading-relaxed text-slate-600">
                    {splitBoldSegments(paragraph).map((seg, k) =>
                      seg.bold ? (
                        <strong key={k} className="font-bold text-slate-900">
                          {seg.text}
                        </strong>
                      ) : (
                        <span key={k}>{seg.text}</span>
                      )
                    )}
                  </p>
                ))}
              </div>
              {pairsAfterSection(i, sections.length, pairs.length).map((k) => (
                <figure key={pairs[k].before.id + pairs[k].after.id} className="space-y-2">
                  <BeforeAfterSlider
                    beforeSrc={pairs[k].before.url}
                    afterSrc={pairs[k].after.url}
                    bigLabels
                    className="min-h-[240px] w-full rounded-2xl shadow-lg"
                  />
                  <figcaption className="text-center text-sm font-semibold text-slate-400">
                    👆 가운데 선을 좌우로 밀어 보세요
                  </figcaption>
                </figure>
              ))}
            </section>
          ))}
        </div>

        {rest.length > 0 && (
          <section className="mt-12 space-y-4">
            <h2 className="text-center text-[22px] font-black text-slate-900">현장 사진 더 보기</h2>
            {rest.map((photo) => (
              <figure key={photo.id} className="relative">
                <AssetImage
                  src={photo.url}
                  alt={STAGE_LABEL[photo.stage]}
                  className="h-auto min-h-[240px] w-full rounded-2xl shadow"
                />
                <span className="absolute left-3 top-3 rounded-lg bg-black/60 px-2.5 py-1 text-sm font-bold text-white">
                  {STAGE_LABEL[photo.stage]}
                </span>
              </figure>
            ))}
          </section>
        )}

        <div className="mt-12">
          <CallBanner />
        </div>
      </article>
    </main>
  );
}
