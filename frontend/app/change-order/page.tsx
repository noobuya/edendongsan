"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import BusinessBanner from "@/components/BusinessBanner";
import SignaturePad from "@/components/SignaturePad";
import { getJobStatus, signChangeOrder } from "@/lib/api";
import type { ChangeOrder } from "@/types";
import { useAndroidBack } from "@/lib/useAndroidBack";

function won(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 현장 추가 시공 즉석 서명 — /warranty·/proposal과 같은 이유로 쿼리스트링
 *  (?job=&co=)을 쓴다. 고객이 카카오톡 링크를 열어 본인 폰에서 직접 서명한다
 *  (사장님이 폰을 건네는 PremiumReceipt 서명과 달리 원격). */
export default function ChangeOrderPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [jobId, setJobId] = useState<string | null>(null);
  const [coId, setCoId] = useState<string | null>(null);
  const [changeOrder, setChangeOrder] = useState<ChangeOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const job = params.get("job");
    const co = params.get("co");
    setJobId(job);
    setCoId(co);
    if (!job || !co) {
      setError("잘못된 주소입니다.");
      return;
    }
    getJobStatus(job)
      .then((status) => {
        const found = status.change_orders.find((c) => c.id === co);
        if (!found) {
          setError("추가 시공 건을 찾을 수 없습니다.");
          return;
        }
        setChangeOrder(found);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "추가 시공 건을 찾을 수 없습니다."));
  }, []);

  async function handleSign(dataUrl: string) {
    if (!jobId || !coId) return;
    const status = await signChangeOrder(jobId, coId, dataUrl);
    const found = status.change_orders.find((c) => c.id === coId);
    if (found) setChangeOrder(found);
  }

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

  if (!changeOrder) {
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

      <h1 className="mb-1 text-[20px] font-bold text-slate-900">현장 추가 시공 안내</h1>
      <p className="mb-6 text-[13px] text-slate-500">아래 내용을 확인하시고 동의하시면 서명해 주세요</p>

      <AssetImage
        src={changeOrder.photo_url}
        alt={changeOrder.description}
        className="mb-5 aspect-[4/3] w-full rounded-xl object-cover shadow-sm"
      />

      <div className="mb-6 rounded-2xl border border-[#eef0f2] px-4 py-4">
        <p className="mb-1 text-[13px] text-[#6b7684]">{formatDate(changeOrder.created_at)}</p>
        <p className="mb-3 text-[15px] font-semibold leading-relaxed text-[#191f28]">{changeOrder.description}</p>
        <div className="flex items-center justify-between border-t border-[#eef0f2] pt-3">
          <span className="text-[14px] font-bold text-[#191f28]">추가 금액</span>
          <span className="text-[18px] font-extrabold tabular-nums text-indigo-600">{won(changeOrder.amount)}</span>
        </div>
      </div>

      {changeOrder.signature ? (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-4 text-emerald-700">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-[14px] font-bold">서명이 완료됐습니다</p>
            <p className="text-[12px] text-emerald-600">{formatDate(changeOrder.signature.signed_at)}</p>
          </div>
        </div>
      ) : (
        <SignaturePad onSign={handleSign} />
      )}
    </main>
  );
}
