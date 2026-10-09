"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, ImagePlus, Loader2 } from "lucide-react";
import ProposalGeneratingSheet from "@/components/proposal/ProposalGeneratingSheet";
import ProposalReviewPanel from "@/components/proposal/ProposalReviewPanel";
import ShareLinkButton from "@/components/ShareLinkButton";
import { checkOwnerToken, createProposal, publishProposal } from "@/lib/api";
import { readOwnerToken, saveOwnerToken } from "@/lib/ownerToken";
import type { Proposal } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

/** 사장님 전용 — AI 제안서 독립 생성 경로. 완료된 견적(job) 화면에서 "AI 제안서
 *  만들기"로 들어오면 ?job=<id>가 붙어 그 견적의 sales_pitch를 카피에 참고시키고,
 *  이 화면에 바로 들어오면 job 연결 없이 사진 한 장만으로도 만들 수 있다
 *  (useSearchParams 대신 window.location — app/blog/post와 같은 이유,
 *  Capacitor 정적 내보내기는 동적 라우트를 못 쓴다). */
export default function NewProposalPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenChecking, setTokenChecking] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [generating, setGenerating] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const job = new URLSearchParams(window.location.search).get("job");
    setJobId(job || undefined);
    setOwnerToken(readOwnerToken());
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleTokenSubmit() {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    setTokenChecking(true);
    setTokenError(null);
    try {
      const result = await checkOwnerToken(trimmed);
      if (result === "ok") {
        saveOwnerToken(trimmed);
        setOwnerToken(trimmed);
      } else if (result === "rejected") {
        setTokenError("토큰이 올바르지 않아요.");
      } else {
        setTokenError("서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setTokenChecking(false);
    }
  }

  function handleFileChange(f: File | null) {
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function handleGenerate() {
    if (!file || !ownerToken) return;
    setError(null);
    setGenerating(true);
    try {
      const created = await createProposal(file, jobId, ownerToken);
      setProposal(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "제안서 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublish() {
    if (!proposal || !ownerToken) return;
    setPublishing(true);
    setError(null);
    try {
      const published = await publishProposal(proposal.id, ownerToken);
      setProposal(published);
    } catch (err) {
      setError(err instanceof Error ? err.message : "발행에 실패했습니다.");
    } finally {
      setPublishing(false);
    }
  }

  if (ownerToken === null) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">사장님 전용 — AI 제안서</h1>
        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[14px] text-slate-600">서버에 설정된 관리자 토큰을 입력하세요.</p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="관리자 토큰"
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && handleTokenSubmit()}
            className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500"
          />
          <button
            disabled={tokenChecking || !tokenInput.trim()}
            onClick={handleTokenSubmit}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
          >
            {tokenChecking ? <Loader2 className="h-5 w-5 animate-spin" /> : "들어가기"}
          </button>
          {tokenError && <p className="text-[14px] font-semibold text-rose-700">{tokenError}</p>}
        </section>
      </main>
    );
  }

  // 발행까지 끝났으면 공유 링크를 보여주고 끝 — 같은 화면에서 새로 하나 더 만들 수도 있다.
  if (proposal?.status === "published") {
    const shareUrl = `${window.location.origin}/proposal?id=${proposal.id}`;
    return (
      <main className="mx-auto max-w-md space-y-5 px-4 py-10 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <h1 className="text-xl font-bold text-slate-900">제안서가 발행됐어요</h1>
        <p className="text-[14px] text-slate-500">아래 링크를 고객에게 카카오톡이나 문자로 보내세요.</p>
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-left text-[13px] text-slate-600 break-all">{shareUrl}</div>
        <ShareLinkButton url={shareUrl} title={proposal.headline} className="mx-auto" />
        <button
          type="button"
          onClick={() => {
            setProposal(null);
            handleFileChange(null);
          }}
          className="mx-auto block text-[14px] text-slate-500 underline underline-offset-4"
        >
          새 제안서 만들기
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 py-6">
      <header className="flex items-center gap-2">
        <Link href="/" aria-label="처음으로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[18px] font-bold text-slate-900">AI 제안서 만들기</h1>
      </header>

      {!proposal ? (
        <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[13.5px] leading-relaxed text-slate-500">
            시공 후 사진 한 장만 올리면, AI가 와이드컷·디테일컷·영업 카피를 자동으로 만들어 드려요.
            {jobId && " 이 견적의 비용 비교 문구도 함께 참고합니다."}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />

          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 로컬에서 고른 파일의 blob URL이라 next/image 대상이 아니다
            <img src={previewUrl} alt="선택한 사진" className="aspect-square w-full rounded-xl object-cover" />
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 text-slate-400"
            >
              <ImagePlus className="h-8 w-8" />
              <span className="text-[13px] font-semibold">사진 선택</span>
            </button>
          )}

          {previewUrl && (
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-100 text-[13.5px] font-semibold text-slate-700">
              <Camera className="h-4 w-4" /> 다른 사진 고르기
            </button>
          )}

          {error && <p className="text-[13px] font-semibold text-rose-700">{error}</p>}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!file || generating}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-indigo-600 text-[16px] font-bold text-white disabled:opacity-40"
          >
            AI 제안서 만들기
          </button>
        </section>
      ) : (
        <ProposalReviewPanel proposal={proposal} ownerToken={ownerToken} onChange={setProposal} onPublish={handlePublish} publishing={publishing} />
      )}

      <ProposalGeneratingSheet open={generating} />
    </main>
  );
}
