"use client";

import React, { useState } from "react";
import { fetchDevBlog, uploadDevShots } from "@/lib/api";

interface Preview {
  url: string;
}

export default function DevShotPage() {
  // ── 스크린샷 여러 장 업로드 ──
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [shotCopied, setShotCopied] = useState(false);
  const [shotError, setShotError] = useState("");

  const shotCommand = paths.length
    ? `${paths.join(" ")} 이 화면${paths.length > 1 ? "들" : ""} 확인해줘`
    : "";

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setPreviews(files.map((f) => ({ url: URL.createObjectURL(f) })));
    setPaths([]);
    setShotCopied(false);
    setShotError("");
    setUploading(true);
    try {
      const result = await uploadDevShots(files);
      setPaths(result.paths);
    } catch (err) {
      setShotError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      // 같은 사진들을 다시 올려도 onChange가 다시 발생하도록 입력값을 비워 둔다.
      e.target.value = "";
    }
  };

  // ── 블로그 글 링크 읽기 ──
  const [blogUrl, setBlogUrl] = useState("");
  const [blogLoading, setBlogLoading] = useState(false);
  const [blogError, setBlogError] = useState("");
  const [blogResult, setBlogResult] = useState<{ path: string; title: string; preview: string } | null>(null);
  const [blogCopied, setBlogCopied] = useState(false);

  const blogCommand = blogResult ? `${blogResult.path} 이 블로그 글 읽고 판단해줘` : "";

  const handleFetchBlog = async () => {
    const url = blogUrl.trim();
    if (!url) return;
    setBlogLoading(true);
    setBlogError("");
    setBlogResult(null);
    setBlogCopied(false);
    try {
      const result = await fetchDevBlog(url);
      setBlogResult(result);
    } catch (err) {
      setBlogError(err instanceof Error ? err.message : "블로그 글을 불러오지 못했습니다.");
    } finally {
      setBlogLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  const handleCopyShot = async () => {
    if (!shotCommand) return;
    await copyToClipboard(shotCommand);
    setShotCopied(true);
    setTimeout(() => setShotCopied(false), 2000);
  };

  const handleCopyBlog = async () => {
    if (!blogCommand) return;
    await copyToClipboard(blogCommand);
    setBlogCopied(true);
    setTimeout(() => setBlogCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-16">
      <header className="bg-slate-900 text-white px-4 py-4">
        <h1 className="text-lg font-extrabold tracking-tight">개발용 업로드</h1>
        <p className="text-xs text-slate-400">화면·블로그 글을 서버로 올리고, 클로드 코드에게 바로 붙여넣을 명령어를 받아요</p>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-5 space-y-8">
        {/* 1. 스크린샷 여러 장 업로드 */}
        <section className="space-y-4">
          <p className="text-xs font-bold text-slate-500">1. 스크린샷 (여러 장 가능)</p>
          <label className="block cursor-pointer rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-[0.99] py-5 text-center text-lg font-black text-slate-900 shadow transition">
            {uploading ? "⏳ 서버로 전송 중..." : "📷 스크린샷 선택 및 서버 전송 (여러 장)"}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
              disabled={uploading}
            />
          </label>

          {shotError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-600">
              {shotError}
            </div>
          )}

          {previews.length > 0 && (
            <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {previews.map((p, idx) => (
                  <img
                    key={idx}
                    src={p.url}
                    alt={`스크린샷 ${idx + 1}`}
                    className="w-full aspect-square object-cover rounded-xl border border-slate-200"
                  />
                ))}
              </div>

              {paths.length > 0 && (
                <>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <p className="text-xs font-bold text-slate-500 mb-1">클로드 코드에 붙여넣을 명령어</p>
                    <p className="text-sm font-mono text-slate-800 break-all">{shotCommand}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyShot}
                    className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-bold rounded-xl text-base shadow transition"
                  >
                    {shotCopied ? "✓ 복사 완료!" : "📋 클로드 명령어 복사"}
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* 2. 블로그 글 링크 읽기 */}
        <section className="space-y-4">
          <p className="text-xs font-bold text-slate-500">2. 블로그 글 링크 (네이버 블로그 등)</p>
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 space-y-3">
            <input
              type="url"
              value={blogUrl}
              onChange={(e) => setBlogUrl(e.target.value)}
              placeholder="https://blog.naver.com/..."
              className="w-full px-3.5 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-slate-900"
            />
            <button
              type="button"
              onClick={handleFetchBlog}
              disabled={blogLoading || !blogUrl.trim()}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 active:scale-[0.99] text-slate-900 font-black rounded-xl text-base shadow transition"
            >
              {blogLoading ? "⏳ 글 가져오는 중..." : "🔗 블로그 글 가져오기"}
            </button>

            {blogError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-600">
                {blogError}
              </div>
            )}

            {blogResult && (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1">
                  {blogResult.title && <p className="text-sm font-bold text-slate-800">{blogResult.title}</p>}
                  <p className="text-xs text-slate-500 line-clamp-3">{blogResult.preview}</p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-xs font-bold text-slate-500 mb-1">클로드 코드에 붙여넣을 명령어</p>
                  <p className="text-sm font-mono text-slate-800 break-all">{blogCommand}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyBlog}
                  className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-bold rounded-xl text-base shadow transition"
                >
                  {blogCopied ? "✓ 복사 완료!" : "📋 클로드 명령어 복사"}
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
