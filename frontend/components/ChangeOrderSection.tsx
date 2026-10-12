"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Loader2, Plus } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import CameraSheet from "@/components/CameraSheet";
import ShareLinkButton from "@/components/ShareLinkButton";
import { createChangeOrder } from "@/lib/api";
import type { ChangeOrder } from "@/types";

function won(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function changeOrderUrl(jobId: string, coId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/change-order?job=${jobId}&co=${coId}`;
}

/** 현장 돌발 변수(밑작업 추가 등)를 그 자리에서 사진+금액으로 등록하고, 고객
 *  폰으로 보낼 서명 링크를 만든다 — 나중에 "그런 말 들은 적 없다"는 분쟁을
 *  막기 위한 기록. 사장님 기기 전용(학생 기기에는 아예 안 보인다 — 작업사진과
 *  달리 읽기 전용으로라도 보여줄 이유가 없다: 추가금은 사장님만 다루는 정보). */
export default function ChangeOrderSection({
  jobId,
  initialChangeOrders,
  ownerToken,
}: {
  jobId: string;
  initialChangeOrders: ChangeOrder[];
  ownerToken: string | null;
}) {
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>(initialChangeOrders);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pendingFile) {
      setPendingPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  if (!ownerToken) return null;

  function resetForm() {
    setPendingFile(null);
    setDescription("");
    setAmount("");
    setError(null);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setPendingFile(file);
  }

  async function handleSubmit() {
    if (!ownerToken || !pendingFile) return;
    const amountNum = Number(amount);
    if (!description.trim()) {
      setError("무슨 작업이 추가됐는지 적어주세요.");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("추가 금액을 올바르게 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const co = await createChangeOrder(jobId, pendingFile, description.trim(), Math.round(amountNum), ownerToken);
      setChangeOrders((prev) => [...prev, co]);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "추가 시공 등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 glass-panel p-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">현장 추가 시공</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          샷시 상태가 안 좋거나 기존 필름을 벗겨내야 하는 등 현장에서 추가 작업이 생기면, 사진과 추가 금액을 바로
          등록하고 고객 폰으로 서명 링크를 보내세요
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {changeOrders.length > 0 && (
        <ul className="space-y-2.5">
          {changeOrders.map((co) => (
            <li key={co.id} className="flex gap-3 rounded-xl border border-slate-100 p-3">
              <AssetImage src={co.photo_url} alt={co.description} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-slate-800">{co.description}</p>
                <p className="mt-0.5 text-[13px] font-bold text-indigo-600">+{won(co.amount)}</p>
                {co.signature ? (
                  <p className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {formatDate(co.signature.signed_at)} 서명 완료
                  </p>
                ) : (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="flex items-center gap-1 text-[11.5px] font-medium text-amber-600">
                      <Clock className="h-3.5 w-3.5" />
                      서명 대기 중
                    </span>
                    <ShareLinkButton
                      url={changeOrderUrl(jobId, co.id)}
                      title="추가 시공 서명 요청"
                      className="!px-2.5 !py-1 !text-[11.5px]"
                    />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingFile ? (
        <div className="space-y-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
          {/* 아직 서버에 올리지 않은 로컬 파일 미리보기라, 백엔드 자산을 불러오는
              AssetImage(fetchAssetObjectUrl) 대신 브라우저가 만든 blob URL을 그냥 쓴다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pendingPreviewUrl ?? undefined}
            alt="추가 시공 사진"
            className="aspect-video w-full rounded-lg object-cover"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="예: 기존 샷시 필름이 벗겨지며 밑작업 추가 필요"
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-300"
          />
          <input
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="추가 금액(원)"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-300"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetForm}
              disabled={submitting}
              className="h-10 flex-1 rounded-lg bg-slate-100 text-[13px] font-semibold text-slate-600 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex h-10 flex-[2] items-center justify-center gap-1.5 rounded-lg bg-indigo-600 text-[13px] font-bold text-white disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? "등록 중..." : "등록하고 공유 링크 만들기"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-[13px] font-semibold text-slate-600"
        >
          <Plus className="h-4 w-4" />
          현장에서 바로 사진 찍고 추가 시공 등록
        </button>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <CameraSheet
        open={cameraOpen}
        onCapture={(file) => {
          setPendingFile(file);
          setCameraOpen(false);
        }}
        onClose={() => setCameraOpen(false)}
        onPickFile={() => {
          setCameraOpen(false);
          fileInputRef.current?.click();
        }}
      />
    </div>
  );
}
