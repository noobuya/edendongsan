"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2, Send } from "lucide-react";
import LevelBadge from "@/components/recruiting/LevelBadge";
import {
  recruitingCommunityPostDetail,
  recruitingCreateCommunityComment,
  type CommunityCategoryValue,
  type CommunityPostDetail,
} from "@/lib/api";
import { useAndroidBack } from "@/lib/useAndroidBack";

const CODE_KEY = "eden-recruiting-code";
const CATEGORY_LABEL: Record<CommunityCategoryValue, string> = {
  TIP: "현장 노하우",
  MATERIAL_SHARE: "자재 나눔",
  QNA: "Q&A",
};

function readCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 글 상세 + 댓글 — /recruiting/community/post?id= 쿼리스트링 방식(Capacitor 정적
 *  내보내기가 동적 라우트 세그먼트를 못 만들어, 이 앱의 다른 상세 화면과 같은 패턴). */
export default function CommunityPostDetailPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [code] = useState(readCode);
  const [id, setId] = useState<string | null>(null);
  const [post, setPost] = useState<CommunityPostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("id");
    setId(value);
    if (!value || !code) {
      setError(!code ? "먼저 /recruiting에서 입장해 주세요." : "잘못된 주소입니다.");
      return;
    }
    recruitingCommunityPostDetail(code, Number(value))
      .then(setPost)
      .catch((err) => setError(err instanceof Error ? err.message : "글을 찾을 수 없습니다."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitComment() {
    if (!comment.trim() || !id) return;
    setBusy(true);
    setError(null);
    try {
      await recruitingCreateCommunityComment(code, Number(id), comment.trim());
      setComment("");
      setPost(await recruitingCommunityPostDetail(code, Number(id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "댓글을 남기지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#f2f4f6] pb-20 text-slate-900">
      <header className="sticky top-0 z-10 bg-[#f2f4f6]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4">
          <Link href="/recruiting/community" aria-label="뒤로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[17px] font-bold tracking-tight">게시글</h1>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!error && !post && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </div>
        )}

        {post && (
          <>
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
              <span className="inline-block rounded-full bg-indigo-50 px-2.5 py-1 text-[11.5px] font-semibold text-indigo-700">
                {CATEGORY_LABEL[post.category]}
              </span>
              <h2 className="mt-2 text-[18px] font-bold text-slate-900">{post.title}</h2>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[13.5px] font-semibold text-slate-700">{post.author_name}</span>
                <LevelBadge level={post.author_level} />
                <span className="text-[12px] text-slate-400">{formatDate(post.created_at)}</span>
              </div>
              <p className="mt-3 whitespace-pre-line text-[14.5px] leading-relaxed text-slate-700">{post.body}</p>
            </section>

            <section className="space-y-2.5">
              <h3 className="px-1 text-[13px] font-bold uppercase tracking-wider text-slate-500">
                댓글 {post.comments.length}개
              </h3>
              {post.comments.length === 0 ? (
                <p className="px-1 text-[13.5px] text-slate-400">아직 댓글이 없어요.</p>
              ) : (
                post.comments.map((c) => (
                  <div key={c.id} className="rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200/70">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-semibold text-slate-800">{c.author_name}</span>
                      <LevelBadge level={c.author_level} />
                      <span className="ml-auto text-[11.5px] text-slate-400">{formatDate(c.created_at)}</span>
                    </div>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-700">{c.body}</p>
                  </div>
                ))
              )}

              <div className="flex items-center gap-2 rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-200/70">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="댓글을 남겨보세요"
                  maxLength={2000}
                  className="h-10 flex-1 bg-transparent px-2 text-[14px] outline-none"
                  onKeyDown={(e) => e.key === "Enter" && submitComment()}
                />
                <button
                  disabled={busy || !comment.trim()}
                  onClick={submitComment}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
