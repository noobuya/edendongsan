"use client";

import React, { useState } from "react";
import { uploadDevShot } from "@/lib/api";

export default function DevShotPage() {
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [path, setPath] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const command = path ? `${path} 이 화면 확인해줘` : "";

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPreviewUrl(URL.createObjectURL(file));
    setPath("");
    setCopied(false);
    setError("");
    setUploading(true);
    try {
      const result = await uploadDevShot(file);
      setPath(result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      // 같은 스크린샷을 다시 올려도 onChange가 다시 발생하도록 입력값을 비워 둔다.
      e.target.value = "";
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

  const handleCopy = async () => {
    if (!command) return;
    await copyToClipboard(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-16">
      <header className="bg-slate-900 text-white px-4 py-4">
        <h1 className="text-lg font-extrabold tracking-tight">개발용 스크린샷 업로드</h1>
        <p className="text-xs text-slate-400">폰 화면을 서버로 올리고, 클로드 코드에게 바로 붙여넣을 명령어를 받아요</p>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-5 space-y-4">
        <label className="block cursor-pointer rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-[0.99] py-5 text-center text-lg font-black text-slate-900 shadow transition">
          {uploading ? "⏳ 서버로 전송 중..." : "📷 스크린샷 선택 및 서버 전송"}
          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" disabled={uploading} />
        </label>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-600">
            {error}
          </div>
        )}

        {previewUrl && (
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 space-y-3">
            <img src={previewUrl} alt="업로드한 스크린샷 미리보기" className="w-full rounded-xl border border-slate-200" />

            {path && (
              <>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-xs font-bold text-slate-500 mb-1">클로드 코드에 붙여넣을 명령어</p>
                  <p className="text-sm font-mono text-slate-800 break-all">{command}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-bold rounded-xl text-base shadow transition"
                >
                  {copied ? "✓ 복사 완료!" : "📋 클로드 명령어 복사"}
                </button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
