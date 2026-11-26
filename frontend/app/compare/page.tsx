"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2, PlayCircle } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BusinessBanner from "@/components/BusinessBanner";
import CallBanner from "@/components/CallBanner";
import ShareLinkButton from "@/components/ShareLinkButton";
import { comparisonVideoUrl, getComparisonBoardPublic } from "@/lib/api";
import type { ComparisonBoard } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

/** 카카오톡·문자로 보내는 공개 AI 가상시공 비교판 — /proposal·/blog/post와 같은
 *  이유로 쿼리스트링(?id=)을 쓴다(Capacitor 정적 내보내기는 동적 라우트 세그먼트를
 *  못 만든다). 발행 전(draft) 상태나 없는 id는 백엔드가 404를 돌려주므로 만드는
 *  중인 비교판이 외부에 새지 않는다. */
export default function ComparisonBoardPublicPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [id, setId] = useState<string | null>(null);
  const [board, setBoard] = useState<ComparisonBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openVideo, setOpenVideo] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("id");
    setId(value);
    if (!value) {
      setError("잘못된 주소입니다.");
      return;
    }
    getComparisonBoardPublic(value)
      .then(setBoard)
      .catch((err) => setError(err instanceof Error ? err.message : "비교판을 찾을 수 없습니다."));
  }, []);

  if (error) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-4 py-16 xs:px-6">
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          처음으로
        </Link>
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      </main>
    );
  }

  if (!id || !board) {
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
        <span className="text-sm text-slate-400">{formatDate(board.created_at)}</span>
        <ShareLinkButton url={typeof window !== "undefined" ? window.location.href : ""} title={board.title} />
      </div>

      <article className="space-y-6">
        <AssetImage src={board.image_url} alt={board.title} className="w-full rounded-xl shadow-sm" />

        <div className="space-y-4">
          {board.areas.map((area) => (
            <div key={area.label} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="mb-2.5 text-[14.5px] font-bold text-slate-800">{area.label}</p>
              <div className="flex flex-wrap gap-2">
                {area.options.map((opt, i) => {
                  const key = `${area.before_photo.id}-${opt.photo.id}`;
                  const isOpen = openVideo === key;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setOpenVideo(isOpen ? null : key)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${
                        isOpen ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      옵션 {i + 1} ({opt.label}) 전후 영상
                    </button>
                  );
                })}
              </div>
              {area.options.map((opt) => {
                const key = `${area.before_photo.id}-${opt.photo.id}`;
                if (openVideo !== key) return null;
                return (
                  <video
                    key={opt.id}
                    src={comparisonVideoUrl(board.id, area.before_photo.id, opt.photo.id, "mp4")}
                    className="mt-3 w-full rounded-lg"
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                );
              })}
            </div>
          ))}
        </div>

        {board.price_note && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-center text-[14.5px] font-bold text-amber-800">
            {board.price_note}
          </p>
        )}

        <CallBanner />
      </article>
    </main>
  );
}
