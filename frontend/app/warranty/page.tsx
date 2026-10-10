"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Leaf, Loader2, ShieldCheck } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BusinessBanner from "@/components/BusinessBanner";
import CallBanner from "@/components/CallBanner";
import ShareLinkButton from "@/components/ShareLinkButton";
import { getWarranty } from "@/lib/api";
import type { Warranty } from "@/lib/api";
import { useAndroidBack } from "@/lib/useAndroidBack";

// PremiumReceipt.tsx의 GUARANTEES와 같은 고정 문구 — 실제로 지키는 내용만
// 적는다는 원칙을 그대로 따른다. AI가 보증 조건을 지어내면 안 되기 때문이다.
const GUARANTEES = [
  { Icon: Leaf, text: "친환경 인증 필름 사용" },
  { Icon: ShieldCheck, text: "1년 무상 A/S 보증" },
];

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

/** 시공 완료+서명된 건의 고객용 디지털 보증서 — /blog/post·/proposal과 같은 이유로
 *  쿼리스트링(?job=)을 쓴다. 서명 전이거나 없는 job_id는 백엔드가 404를 돌려주므로
 *  진행 중인 견적이 고객에게 새 나가지 않는다. */
export default function WarrantyPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [jobId, setJobId] = useState<string | null>(null);
  const [warranty, setWarranty] = useState<Warranty | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("job");
    setJobId(value);
    if (!value) {
      setError("잘못된 주소입니다.");
      return;
    }
    getWarranty(value)
      .then(setWarranty)
      .catch((err) => setError(err instanceof Error ? err.message : "보증서를 찾을 수 없습니다."));
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

  if (!jobId || !warranty) {
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
        <span className="text-sm text-slate-400">{formatDate(warranty.completed_at)} 시공 완료</span>
        <ShareLinkButton
          url={typeof window !== "undefined" ? window.location.href : ""}
          title="디지털 보증서"
        />
      </div>

      {warranty.after_image_url && (
        <AssetImage
          src={warranty.after_image_url}
          alt="시공 완료"
          className="mb-6 aspect-[4/3] w-full rounded-xl object-cover shadow-sm"
        />
      )}

      <section className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-5 text-center">
        <p className="text-[13px] font-semibold text-indigo-600">디지털 보증서</p>
        <p className="mt-1 text-[22px] font-extrabold tracking-tight text-indigo-900">
          {formatDate(warranty.warranty_expires_at)}까지
        </p>
        <p className="mt-1 text-[13px] text-indigo-500">무상 A/S 보증 기간</p>
      </section>

      {warranty.item_names.length > 0 && (
        <section className="mb-6">
          <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-slate-500">시공 내역</p>
          <div className="flex flex-wrap gap-1.5">
            {warranty.item_names.map((name) => (
              <span key={name} className="rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-700">
                {name}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="mb-6 flex flex-wrap gap-2">
        {GUARANTEES.map(({ Icon, text }) => (
          <span
            key={text}
            className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-800"
          >
            <Icon className="h-3.5 w-3.5" />
            {text}
          </span>
        ))}
      </section>

      <section className="mb-8">
        <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-slate-500">유지관리 팁</p>
        <ul className="space-y-2 rounded-xl border border-slate-100 bg-white p-4">
          {warranty.maintenance_tips.map((tip, i) => (
            <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-slate-700">
              <span className="text-slate-300">·</span>
              {tip}
            </li>
          ))}
        </ul>
      </section>

      <CallBanner />
    </main>
  );
}
