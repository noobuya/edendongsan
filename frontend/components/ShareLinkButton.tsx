"use client";

import { useState } from "react";
import { Check, Link as LinkIcon, Share2 } from "lucide-react";

interface Props {
  /** 공유할 전체 URL. 호출하는 쪽에서 window.location.href 등으로 만들어 넘긴다. */
  url: string;
  title: string;
  className?: string;
}

/** 링크 공유 버튼 — 모바일에서 공유 시트(navigator.share)를 지원하는 브라우저는
 *  그걸 쓰고, 아니면 클립보드에 링크를 복사한다. 둘 다 안 되면 조용히 숨는다
 *  (공유할 방법이 없는 환경에서 눌러도 아무 일 없는 버튼을 보여주지 않는다). */
export default function ShareLinkButton({ url, title, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // 공유 시트를 취소했거나 실패하면 클립보드 복사로 넘어간다.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한이 없는 드문 환경 — 아무 피드백 없이 조용히 넘어간다.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition active:scale-95 ${className}`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          링크 복사됨
        </>
      ) : typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
        <>
          <Share2 className="h-3.5 w-3.5" />
          공유하기
        </>
      ) : (
        <>
          <LinkIcon className="h-3.5 w-3.5" />
          링크 복사
        </>
      )}
    </button>
  );
}
