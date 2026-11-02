"use client";

import { useState } from "react";
import { Check, Copy, Download, ListOrdered, Loader2 } from "lucide-react";
import NaverStepCopyPanel from "@/components/blog/NaverStepCopyPanel";
import { copyPostToClipboard, saveAllPhotos, type NaverExportPost } from "@/lib/naverBlogExport";

/** 네이버 블로그 "1초 팩" — 네이버 Open API의 블로그 글쓰기는 OAuth 로그인 연동·심사가
 *  따로 필요해 자동 포스팅 대신 반자동으로 간다.
 *
 *  [2026-11-03 정리 — "전체 복사(사진 포함)를 붙여도 사진이 안 나온다"]
 *  글 속 <img>로 사진을 넣는 방식은 data URI도, 공개 https 주소도 네이버 에디터가
 *  붙여넣을 때 사진을 받지 않았다(사장님 실측 2회, PC 엣지). 그래서 "전체 복사(사진
 *  포함)"는 없앴다 — 사진이 안 들어가는데 이름이 "사진 포함"이면 매번 헷갈린다.
 *  사진이 있으면 초록 버튼이 "한 장씩 복사" 순서표(NaverStepCopyPanel)를 연다: 글 →
 *  사진1 → 사진2 … 를 클립보드에 넣고 Ctrl+V. 사진은 "파일"(PNG)로 들어가 네이버가
 *  화면 캡처 붙여넣기처럼 바로 올린다.
 *  [사진 전체 저장] 휴대폰은 공유 시트(갤러리 저장/네이버 블로그 앱으로 보내기), PC는
 *  다운로드 — 내려받은 사진을 네이버 글쓰기 화면에 한꺼번에 끌어다 놓아도 된다. */
export default function CopyToNaverButton({ post, className = "" }: { post: NaverExportPost; className?: string }) {
  const [busy, setBusy] = useState<"copy" | "save" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const hasPhotos = !!post.coverUrl || post.photos.length > 0;
  const onProgress = (done: number, total: number) => setProgress({ done, total });

  // 사진이 없는 글은 순서표가 필요 없으니 글만 바로 복사한다.
  async function handleCopyText() {
    setBusy("copy");
    setMessage(null);
    try {
      await copyPostToClipboard(post);
      setMessage({ ok: true, text: "복사됨 — 네이버 블로그 글쓰기 화면에 붙여넣으세요" });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "복사하지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy("save");
    setMessage(null);
    setProgress(null);
    try {
      const how = await saveAllPhotos(post, onProgress);
      setMessage({
        ok: true,
        text:
          how === "shared"
            ? "사진을 보냈어요"
            : "사진을 모두 내려받았어요 — 내려받은 사진들을 네이버 글쓰기 화면에 한꺼번에 끌어다 놓으세요",
      });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "사진을 저장하지 못했습니다." });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const progressText = progress && progress.total > 0 ? ` (${progress.done}/${progress.total})` : "";

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {hasPhotos ? (
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="flex items-center gap-1.5 rounded-full bg-[#03c75a] px-3.5 py-2 text-[13px] font-semibold text-white transition active:scale-95"
          >
            <ListOrdered className="h-3.5 w-3.5" />
            {showSteps ? "순서표 닫기" : "네이버 블로그로 옮기기 (글 + 사진)"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCopyText}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-full bg-[#03c75a] px-3.5 py-2 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-60"
          >
            {busy === "copy" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : message?.ok ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            네이버 블로그용 복사
          </button>
        )}
        {hasPhotos && (
          <button
            type="button"
            onClick={handleSave}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition active:scale-95 disabled:opacity-60"
          >
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busy === "save" ? `사진 준비 중${progressText}` : "사진 전체 저장"}
          </button>
        )}
      </div>
      {message && (
        <p className={`text-xs ${message.ok ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>
      )}
      {showSteps && <NaverStepCopyPanel post={post} />}
    </div>
  );
}
