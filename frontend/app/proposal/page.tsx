"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import BusinessBanner from "@/components/BusinessBanner";
import CallBanner from "@/components/CallBanner";
import ROIBarChart from "@/components/ROIBarChart";
import ProposalEstimateSummary from "@/components/proposal/ProposalEstimateSummary";
import ProposalSiteConditionsSummary from "@/components/proposal/ProposalSiteConditionsSummary";
import ShareLinkButton from "@/components/ShareLinkButton";
import { getProposalPublic } from "@/lib/api";
import type { ProposalPublic } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

/** 카카오톡·문자로 보내는 공개 제안서 — /blog/post와 같은 이유로 쿼리스트링(?id=)을
 *  쓴다(Capacitor 정적 내보내기는 동적 라우트 세그먼트를 못 만든다). 발행 전(review)
 *  상태나 없는 id는 백엔드가 404를 돌려주므로 초안이 외부에 새지 않는다. */
export default function ProposalPublicPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [id, setId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposalPublic | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("id");
    setId(value);
    if (!value) {
      setError("잘못된 주소입니다.");
      return;
    }
    setProposal(null);
    setError(null);
    getProposalPublic(value)
      .then(setProposal)
      .catch((err) => setError(err instanceof Error ? err.message : "제안서를 찾을 수 없습니다."));
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

  if (!id || !proposal) {
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
        <span className="text-sm text-slate-400">{formatDate(proposal.created_at)}</span>
        <ShareLinkButton url={typeof window !== "undefined" ? window.location.href : ""} title={proposal.headline} />
      </div>

      <article>
        {proposal.before_image_url ? (
          <BeforeAfterSlider
            beforeSrc={proposal.before_image_url}
            afterSrc={proposal.wide_image_url}
            className="mb-5 aspect-[4/3] w-full overflow-hidden rounded-xl shadow-sm"
          />
        ) : (
          <AssetImage
            src={proposal.wide_image_url}
            alt={proposal.headline}
            className="mb-5 aspect-[4/3] w-full rounded-xl object-cover shadow-sm"
          />
        )}

        <header className="mb-5">
          <h1 className="text-2xl font-bold leading-snug text-slate-900">{proposal.headline}</h1>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{proposal.body}</p>
        </header>

        {proposal.estimate?.roi_comparison && <ROIBarChart roi={proposal.estimate.roi_comparison} />}
        {proposal.estimate && <ProposalEstimateSummary estimate={proposal.estimate} />}
        {proposal.site_conditions && <ProposalSiteConditionsSummary conditions={proposal.site_conditions} />}

        <AssetImage
          src={proposal.detail_image_url}
          alt="시공 디테일"
          className="mb-8 aspect-square w-full rounded-xl object-cover shadow-sm"
        />

        <CallBanner />
      </article>
    </main>
  );
}
