"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { BlogPost } from "@/types";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 문단(빈 줄로 구분)마다 <p>로, 문단 안 줄바꿈은 <br>로 — content는 blog_writer.py가
 *  "\n\n"으로 문단을 나눠 돌려주는 형식을 그대로 따른다. */
function toHtmlParagraphs(content: string): string {
  return content
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function buildHtml(post: BlogPost): string {
  const hashtagsHtml = post.hashtags.length
    ? `<p>${post.hashtags.map(escapeHtml).join(" ")}</p>`
    : "";
  return `<h2>${escapeHtml(post.title)}</h2>${toHtmlParagraphs(post.content)}${hashtagsHtml}`;
}

function buildPlainText(post: BlogPost): string {
  const parts = [post.title, post.content];
  if (post.hashtags.length) parts.push(post.hashtags.join(" "));
  return parts.join("\n\n");
}

/** 네이버 블로그 "1초 팩" — 네이버 Open API의 블로그 글쓰기는 OAuth 로그인 연동·심사가
 *  따로 필요해 자동 포스팅 대신 반자동으로 간다. 네이버 스마트에디터는 contenteditable
 *  기반이라, ClipboardItem으로 text/html을 함께 복사해두면 "붙여넣기"만으로 글자 크기·
 *  문단 구분 같은 서식이 어느 정도 같이 들어간다(raw HTML 태그가 그대로 보이는 것보다
 *  훨씬 완성도가 높다). text/html 복사를 지원하지 않는 환경(구형 브라우저, 일부
 *  인앱 웹뷰)에서는 평문 복사로 조용히 물러난다. */
export default function CopyToNaverButton({ post, className = "" }: { post: BlogPost; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const plain = buildPlainText(post);
    try {
      if (typeof ClipboardItem !== "undefined") {
        const html = buildHtml(post);
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plain], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // 클립보드 권한이 없는 드문 환경 — 아무 피드백 없이 조용히 넘어간다.
      }
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition active:scale-95 ${className}`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          복사됨 — 네이버 블로그에 붙여넣으세요
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          네이버 블로그용 복사
        </>
      )}
    </button>
  );
}
