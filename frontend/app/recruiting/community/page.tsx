"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import LevelBadge from "@/components/recruiting/LevelBadge";
import { recruitingCommunityPosts, recruitingCreateCommunityPost, type CommunityCategoryValue, type CommunityPost } from "@/lib/api";
import { useAndroidBack } from "@/lib/useAndroidBack";

const CODE_KEY = "eden-recruiting-code";
const CARD = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70";
const CATEGORY_LABEL: Record<CommunityCategoryValue, string> = {
  TIP: "현장 노하우",
  MATERIAL_SHARE: "자재 나눔",
  QNA: "Q&A",
};
const CATEGORY_TONE: Record<CommunityCategoryValue, string> = {
  TIP: "bg-indigo-50 text-indigo-700",
  MATERIAL_SHARE: "bg-emerald-50 text-emerald-700",
  QNA: "bg-amber-50 text-amber-700",
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

/** 현장 노하우·자재 나눔·Q&A 커뮤니티. 글·댓글 작성자 이름 옆엔 항상
 *  LevelBadge가 따라붙는다 — "Lv.5 마스터가 답변한 믿을 수 있는 정보"임을
 *  한눈에 알 수 있게 한다. */
export default function CommunityListPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [code] = useState(readCode);
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [category, setCategory] = useState<CommunityCategoryValue>("QNA");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setError("먼저 /recruiting에서 입장해 주세요.");
      return;
    }
    recruitingCommunityPosts(code)
      .then(setPosts)
      .catch((err) => setError(err instanceof Error ? err.message : "불러오지 못했습니다."));
  }, [code]);

  async function submit() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await recruitingCreateCommunityPost(code, { category, title: title.trim(), body: body.trim() });
      setTitle("");
      setBody("");
      setWriting(false);
      setPosts(await recruitingCommunityPosts(code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "작성하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#f2f4f6] pb-20 text-slate-900">
      <header className="sticky top-0 z-10 bg-[#f2f4f6]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-3 px-4">
          <Link href="/recruiting" aria-label="뒤로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[17px] font-bold tracking-tight">실무 커뮤니티</h1>
          {code && (
            <button
              onClick={() => setWriting((v) => !v)}
              className="ml-auto flex h-10 items-center gap-1 rounded-full bg-indigo-600 px-3.5 text-[13.5px] font-semibold text-white"
            >
              <Plus className="h-4 w-4" /> 글쓰기
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-3 px-4 pt-4">
        {error && <p className="px-1 text-[14px] font-semibold text-rose-700">{error}</p>}

        {writing && (
          <section className={`${CARD} space-y-2.5`}>
            <div className="flex gap-2">
              {(Object.keys(CATEGORY_LABEL) as CommunityCategoryValue[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`h-9 flex-1 rounded-lg text-[12.5px] font-semibold transition ${
                    category === c ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목"
              maxLength={120}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] outline-none focus:border-indigo-500"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="내용"
              maxLength={5000}
              className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-indigo-500"
            />
            <button
              disabled={busy || !title.trim() || !body.trim()}
              onClick={submit}
              className="h-11 w-full rounded-xl bg-indigo-600 text-[14px] font-bold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "등록"}
            </button>
          </section>
        )}

        {!error && posts === null && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </div>
        )}
        {posts?.length === 0 && <p className="py-16 text-center text-sm text-slate-400">아직 올라온 글이 없어요.</p>}

        {posts?.map((p) => (
          <Link key={p.id} href={`/recruiting/community/post?id=${p.id}`} className={`${CARD} block`}>
            <span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${CATEGORY_TONE[p.category]}`}>
              {CATEGORY_LABEL[p.category]}
            </span>
            <p className="mt-2 text-[15px] font-bold text-slate-900">{p.title}</p>
            <p className="mt-1 line-clamp-2 text-[13.5px] text-slate-500">{p.body}</p>
            <div className="mt-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-slate-700">{p.author_name}</span>
                <LevelBadge level={p.author_level} />
              </div>
              <span className="text-[12px] text-slate-400">
                댓글 {p.comment_count} · {formatDate(p.created_at)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
