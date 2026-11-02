"use client";

import { useState } from "react";
import { Check, Copy, Download, ListOrdered, Loader2 } from "lucide-react";
import NaverStepCopyPanel from "@/components/blog/NaverStepCopyPanel";
import { copyPostToClipboard, saveAllPhotos, type NaverExportPost } from "@/lib/naverBlogExport";

/** 네이버 블로그 "1초 팩" — 네이버 Open API의 블로그 글쓰기는 OAuth 로그인 연동·심사가
 *  따로 필요해 자동 포스팅 대신 반자동으로 간다.
 *
 *  [전체 복사] 제목·본문·시공 전/후 사진·해시태그를 블로그 화면과 같은 순서로 한 번에
 *  복사한다. 사진은 공개 https 주소의 <img>로 들어간다(lib/naverBlogExport.ts 주석 참고).
 *  [한 장씩 복사] 글 → 사진1 → 사진2 … 를 하나씩 클립보드에 넣는다. 사진이 "파일"로
 *  들어가 네이버가 확실히 업로드한다 — 전체 복사에서 사진이 빠질 때의 확실한 경로.
 *  [사진 전체 저장] 네이버 블로그 휴대폰 앱처럼 붙여넣기로 사진이 안 들어가는 곳을 위한
 *  안전망 — 휴대폰은 공유 시트로 갤러리 저장/네이버 블로그 앱에 바로 보내기, PC는 다운로드. */
export default function CopyToNaverButton({ post, className = "" }: { post: NaverExportPost; className?: string }) {
  const [busy, setBusy] = useState<"copy" | "save" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const hasPhotos = !!post.coverUrl || post.photos.length > 0;
  const onProgress = (done: number, total: number) => setProgress({ done, total });

  async function handleCopy() {
    setBusy("copy");
    setMessage(null);
    try {
      await copyPostToClipboard(post);
      setMessage({
        ok: true,
        text: hasPhotos
          ? "전체 복사됨 — 네이버 블로그 글쓰기 화면에 Ctrl+V. 사진이 빠지면 아래 '한 장씩 복사'를 쓰세요."
          : "복사됨 — 네이버 블로그 글쓰기 화면에 붙여넣으세요",
      });
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
        text: how === "shared" ? "사진을 보냈어요" : "사진을 모두 내려받았어요 — 네이버 블로그에서 사진 추가로 올리세요",
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
        <button
          type="button"
          onClick={handleCopy}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-full bg-[#03c75a] px-3.5 py-2 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-60"
        >
          {busy === "copy" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : message?.ok && !busy ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {busy === "copy" ? "복사 중" : hasPhotos ? "네이버 블로그용 전체 복사 (사진 포함)" : "네이버 블로그용 복사"}
        </button>
        {hasPhotos && (
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition active:scale-95 ${
              showSteps ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-800"
            }`}
          >
            <ListOrdered className="h-3.5 w-3.5" />
            한 장씩 복사 (사진 확실히 넣기)
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
