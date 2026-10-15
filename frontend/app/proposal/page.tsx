"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import BodaqSimulatorBanner from "@/components/BodaqSimulatorBanner";
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
          <>
            <BeforeAfterSlider
              beforeSrc={proposal.before_image_url}
              afterSrc={proposal.wide_image_url}
              className="aspect-[4/3] w-full overflow-hidden rounded-xl shadow-sm"
            />
            <p className="mb-5 mt-1.5 text-center text-[12px] text-slate-400">
              좌우로 밀어서 시공 전/후를 비교해 보세요
            </p>
          </>
        ) : (
          <>
            <AssetImage
              src={proposal.wide_image_url}
              alt={proposal.headline}
              className="aspect-[4/3] w-full rounded-xl object-cover shadow-sm"
            />
            <p className="mb-5 mt-1.5 text-center text-[12px] text-slate-400">시공 전체 모습</p>
          </>
        )}

        <header className="mb-5">
          <h1 className="text-2xl font-bold leading-snug text-slate-900">{proposal.headline}</h1>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{proposal.body}</p>
        </header>

        {proposal.estimate?.roi_comparison && <ROIBarChart roi={proposal.estimate.roi_comparison} />}

        {/* 어떤 필름을 쓰는지(브랜드/품번)와 A/S 보증을 가격 바로 위에서 먼저
            보여준다 — 고객이 "정체불명의 필름"이 아니라 실제 제품명을 보고,
            가격을 보기 전에 보증이 있다는 걸 먼저 알면 금액에 대한 거부감이 준다. */}
        {proposal.estimate && proposal.estimate.material_orders.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            {proposal.estimate.material_orders.map((m) => (
              <span
                key={m.pattern_id}
                className="flex items-center gap-1.5 rounded-full border border-[#eef0f2] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#333d4b]"
              >
                {m.color_hex && (
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: m.color_hex }}
                  />
                )}
                {m.name}
              </span>
            ))}
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-800">
              <ShieldCheck className="h-3.5 w-3.5" />
              1년 무상 A/S 보증
            </span>
          </div>
        )}

        {proposal.estimate && <ProposalEstimateSummary estimate={proposal.estimate} />}

        {/* 대표님이 고른 색 말고 다른 보닥 컬러도 고객이 직접 둘러보고 싶을 수
            있다 — 견적까지 다 보고 난 자리에서, 현대엘앤씨 공식 사이트로 보내
            "다른 색은 왜 안 보여주냐"는 불안을 없애고, 정품 필름을 쓴다는
            신뢰도 같이 전달한다. */}
        <BodaqSimulatorBanner variant="customer" />

        {proposal.site_conditions && <ProposalSiteConditionsSummary conditions={proposal.site_conditions} />}

        <AssetImage
          src={proposal.detail_image_url}
          alt="시공 디테일"
          className="aspect-square w-full rounded-xl object-cover shadow-sm"
        />
        <p className="mb-8 mt-1.5 text-center text-[12px] text-slate-400">
          마감 질감을 가까이서 확대한 모습
        </p>

        <CallBanner />
      </article>
    </main>
  );
}
