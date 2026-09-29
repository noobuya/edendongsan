"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Download, Hammer, Leaf, Lock, MessageCircle, Share2, ShieldCheck, X } from "lucide-react";
import BusinessBadge from "@/components/BusinessBanner";
import QuoteIcon, { toneOfWorkItem } from "@/components/quote/QuoteIcon";
import { BUSINESS_NAME, BUSINESS_PHONE } from "@/lib/businessInfo";
import type { EstimateBreakdown, WorkItemId } from "@/types";

function won(amount: number): string {
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

// 필름 계열은 표면 처리 공정이 핵심이라 그 공정을 "일체 포함"으로 보여준다.
// 그 밖의 품목에는 이 공정이 없으므로 같은 문구를 붙이면 사실과 어긋난다.
const FILM_FAMILY: WorkItemId[] = ["film", "sash", "door_frame", "wardrobe", "wall_film"];
const FILM_NOTE = "기존 실리콘 제거, 친환경 프라이머 도포 및 정밀 평탄화(퍼티) 작업 일체 포함";
const GENERIC_NOTE = "자재, 설치, 마감 정리까지 일체 포함";

const GUARANTEES = [
  { text: "친환경 인증 필름 사용", Icon: Leaf, tone: "bg-emerald-50 text-emerald-800" },
  { text: "전문 기공 직접 시공", Icon: Hammer, tone: "bg-indigo-50 text-indigo-800" },
  { text: "1년 무상 A/S 보증", Icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-800" },
];

const DOUBLE_TAP_MS = 300;
const LONG_PRESS_MS = 650;
const MOVE_TOLERANCE_PX = 12;

/** 사장님만 아는 숨은 입구: 총액을 빠르게 두 번 탭하거나 길게 누르면 onTrigger. */
export function useSecretTrigger(onTrigger: () => void) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  const longFired = useRef(false);

  function clear() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  return {
    onPointerDown: (e: React.PointerEvent) => {
      longFired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      pressTimer.current = setTimeout(() => {
        longFired.current = true;
        onTrigger();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE_PX) clear();
    },
    onPointerCancel: clear,
    onPointerUp: () => {
      clear();
      if (longFired.current) {
        longFired.current = false;
        lastTap.current = 0;
        return;
      }
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        onTrigger();
      } else {
        lastTap.current = now;
      }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

function issueDateLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// 문자로 견적서를 보낼 때 미리 채워 넣는 안내 문구. sms: 링크는 파일을 첨부하지 못하므로
// (표준 자체에 없다), 사진은 별도로 갤러리에 저장해 사장님이 문자 앱에서 직접 첨부해야 한다.
const SMS_BODY = `안녕하세요, ${BUSINESS_NAME} 인테리어 필름 견적서입니다.`;

/** 입력하는 대로 010-1234-5678 모양으로 다듬는다. 숫자만 남기고 11자리로 자른 뒤
 *  3-4-4(또는 입력이 짧을 때는 3-3/3-4)로 하이픈을 끼워 넣는다. */
function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/** 안드로이드 기본 문자 앱을 여는 sms: 링크. (이 앱은 안드로이드 전용이라 iOS의
 *  "&body=" 방식은 다루지 않는다 — PRODUCT.md 참고.) */
function buildSmsHref(phoneDigits: string): string {
  return `sms:${phoneDigits}?body=${encodeURIComponent(SMS_BODY)}`;
}

export interface ReceiptRow {
  key: string;
  icon: ReactNode;
  name: string;
  /** 이름 옆 작은 설명(예: 디자인 타입). */
  tag?: string | null;
  /** "2개 × 250,000원" 같은 수량 줄. */
  qtyLine?: string;
  note: string;
  amount: number;
}

interface ReceiptViewProps {
  rows: ReceiptRow[];
  /** 부가세를 따로 보여주는 견적서면 값을 넘기고, 세금 구분이 없는 견적서면 null. */
  supplyAmount: number;
  vat: number | null;
  total: number;
  /** 원가 분석(사장님 전용)에만 쓰인다. 고객 화면·캡처 이미지에는 나오지 않는다. */
  materialTotal: number;
  expenseTotal: number;
  estimateNo: string;
  /** 상호 뱃지를 3초 길게 눌렀을 때 — 단가 설정(개발자 모드)을 연다. */
  onSecretHold?: () => void;
}

/** 견적 API(메인 백엔드)의 EstimateBreakdown을 영수증으로 그린다. */
export default function PremiumReceipt({
  estimate,
  jobId,
  onSecretHold,
}: {
  estimate: EstimateBreakdown;
  jobId: string;
  onSecretHold?: () => void;
}) {
  const rows: ReceiptRow[] = estimate.line_items.map((li) => ({
    key: li.item_id,
    icon: <QuoteIcon workItem={li.item_id} tone={toneOfWorkItem(li.item_id)} size={36} />,
    name: li.item_name,
    note: FILM_FAMILY.includes(li.item_id) ? FILM_NOTE : GENERIC_NOTE,
    amount: li.subtotal,
  }));
  return (
    <PremiumReceiptView
      rows={rows}
      supplyAmount={estimate.supply_amount}
      vat={estimate.vat}
      total={estimate.total_cost}
      materialTotal={estimate.material_total}
      expenseTotal={estimate.expense_total}
      estimateNo={`ED-${jobId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase()}`}
      onSecretHold={onSecretHold}
    />
  );
}

export function PremiumReceiptView({
  rows,
  supplyAmount,
  vat,
  total,
  materialTotal,
  expenseTotal,
  estimateNo,
  onSecretHold,
}: ReceiptViewProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [stealthOpen, setStealthOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 협의 공급가액: 고객과 가격을 조정할 때 사장님이 입력하는 값(견적서에는 반영되지 않는다).
  const [negotiated, setNegotiated] = useState<string>("");

  // navigator.share가 없거나 실패했을 때의 안전한 대안 — 캡처한 이미지를 화면에 먼저
  // 보여주고, "갤러리에 저장" → "전화번호 입력" → "문자 앱 열기" 순서로 이어간다.
  const [shareFallback, setShareFallback] = useState<{
    step: "preview" | "phone";
    blob: Blob;
    url: string;
    filename: string;
    saved: boolean;
  } | null>(null);
  const [phone, setPhone] = useState("");

  const secret = useSecretTrigger(() => setStealthOpen((v) => !v));

  // 모달을 닫거나 다른 이미지로 바뀔 때 남은 objectURL을 정리한다.
  useEffect(() => {
    return () => {
      if (shareFallback) URL.revokeObjectURL(shareFallback.url);
    };
  }, [shareFallback]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  async function handleShare() {
    const node = cardRef.current;
    if (!node || sharing) return;
    setSharing(true);
    try {
      // 무거운 라이브러리라 눌렀을 때만 불러온다.
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("blob");
      const filename = `${BUSINESS_NAME}_견적서_${issueDateLabel().replace(/\./g, "")}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `${BUSINESS_NAME} 프리미엄 견적서`,
            text: "고객님, 요청하신 프리미엄 인테리어 필름 시공 견적서입니다.",
          });
          showToast("견적서를 공유했습니다");
          return;
        } catch (err) {
          // 사용자가 공유창에서 직접 취소한 경우(AbortError)는 그 뜻을 존중하고
          // 아무 것도 하지 않는다 — 그 외(권한 거부, 미지원, 삼성 인터넷 등 일부
          // 모바일 브라우저의 파일 공유 실패)는 화면에 보여주는 대안으로 이어간다.
          if ((err as Error).name === "AbortError") return;
        }
      }
      // navigator.share를 쓸 수 없거나 실패한 경우의 안전한 대안.
      setShareFallback({ step: "preview", blob, url: URL.createObjectURL(blob), filename, saved: false });
    } catch {
      showToast("이미지 생성에 실패했습니다");
    } finally {
      setSharing(false);
    }
  }

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /** 모바일 브라우저·WebView에서는 blob: URL로 내려받다가 objectURL을 회수(revoke)하는
   *  타이밍이 실제 다운로드 시작보다 앞서면 저장이 조용히 실패한다(실제로 재현됨,
   *  아무 오류도 뜨지 않아 원인을 알기 어렵다). data: URI로 바꾸면 회수할 대상 자체가
   *  없어 이 경합이 사라진다. */
  async function downloadBlob(blob: Blob, filename: string) {
    const dataUrl = await blobToDataUrl(blob);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleSaveToGallery() {
    if (!shareFallback) return;
    try {
      // 안드로이드 앱(WebView)에서는 <a download>가 갤러리에 닿지 못해(다운로드
      // 폴더에만 남거나 조용히 실패) 네이티브 플러그인으로 MediaStore에 직접 등록한다.
      // 일반 웹 브라우저(개발 중 데스크톱 확인 등)에서는 기존 방식을 그대로 쓴다.
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { default: GallerySaver } = await import("@/lib/gallerySaver");
        const dataUrl = await blobToDataUrl(shareFallback.blob);
        await GallerySaver.saveImage({ data: dataUrl, fileName: shareFallback.filename });
      } else {
        await downloadBlob(shareFallback.blob, shareFallback.filename);
      }
      setShareFallback((s) => (s ? { ...s, saved: true } : s));
      showToast("이미지를 갤러리에 저장했습니다");
    } catch {
      showToast("자동 저장에 실패했습니다. 위 이미지를 길게 눌러 저장해 주세요");
    }
  }

  function closeShareFallback() {
    setShareFallback(null);
    setPhone("");
  }

  const phoneDigits = phone.replace(/\D/g, "");

  async function handleSendSms() {
    if (phoneDigits.length < 9) return;
    // 방금 저장한 이미지가 없다면 문자 앱을 열기 전에 먼저 저장해 둔다 — 문자 앱에서
    // 첨부할 사진이 갤러리에 있어야 하기 때문이다.
    if (shareFallback && !shareFallback.saved) await handleSaveToGallery();
    window.location.href = buildSmsHref(phoneDigits);
    closeShareFallback();
    showToast("문자 앱이 열렸습니다. 저장된 견적서 이미지를 직접 첨부해서 보내주세요");
  }

  // ---- 사장님 전용 원가 분석 (고객 화면·캡처 이미지에는 들어가지 않는다) ----
  const costTotal = materialTotal + expenseTotal;
  const marginAmount = supplyAmount - costTotal;
  const marginRate = supplyAmount > 0 ? (marginAmount / supplyAmount) * 100 : 0;

  const negotiatedNum = negotiated === "" ? null : Math.max(0, parseInt(negotiated, 10) || 0);
  const negotiatedMargin = negotiatedNum === null ? null : negotiatedNum - costTotal;
  const negotiatedRate =
    negotiatedNum && negotiatedNum > 0 && negotiatedMargin !== null ? (negotiatedMargin / negotiatedNum) * 100 : null;
  const discountRate =
    negotiatedNum !== null && supplyAmount > 0 ? ((supplyAmount - negotiatedNum) / supplyAmount) * 100 : null;

  return (
    <div className="space-y-3">
      {/* 이 카드가 통째로 이미지로 저장·공유된다. 원가 관련 요소를 넣지 않는다. */}
      <div
        ref={cardRef}
        className="rounded-[24px] bg-white px-6 pb-6 pt-6 text-[#191f28] shadow-[0_1px_2px_rgba(25,31,40,0.05),0_12px_32px_-12px_rgba(25,31,40,0.16)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-[17px] font-extrabold text-white">
              {BUSINESS_NAME.charAt(0)}
            </div>
            <div>
              <p className="text-[16px] font-bold leading-tight tracking-tight">{BUSINESS_NAME}</p>
              <p className="mt-0.5 text-[13px] text-[#5b6573]">시공 견적서</p>
            </div>
          </div>
          <div className="text-right text-[12px] leading-[1.5] tabular-nums text-[#5b6573]">
            <p>{issueDateLabel()}</p>
            <p>{estimateNo}</p>
          </div>
        </div>

        {/* 합계를 맨 위에 — 고객이 가장 먼저 보고 싶은 숫자다. */}
        <div className="mt-7">
          <p className="text-[14px] font-medium text-[#5b6573]">총 예상 견적</p>
          <p
            {...secret}
            style={{ WebkitTouchCallout: "none", touchAction: "manipulation" }}
            className="mt-1 cursor-pointer select-none text-[38px] font-extrabold leading-none tracking-[-0.03em] tabular-nums"
          >
            {total.toLocaleString("ko-KR")}
            <span className="ml-1 text-[20px] font-bold text-[#5b6573]">원</span>
          </p>
          <p className="mt-2 text-[13px] text-[#5b6573]">
            {vat !== null ? "부가세 포함 금액입니다" : "현장 실측 후 최종 확정됩니다"}
          </p>
        </div>

        <hr className="my-5 border-t border-dashed border-[#d1d6db]" />

        <ul className="space-y-5">
          {rows.map((r) => (
            <li key={r.key} className="flex gap-3">
              {r.icon}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-[15px] font-semibold leading-snug">{r.name}</p>
                  <p className="shrink-0 text-[15px] font-bold tabular-nums">{won(r.amount)}</p>
                </div>
                {r.tag && <p className="mt-0.5 text-[13px] text-[#5b6573]">{r.tag}</p>}
                {r.qtyLine && (
                  <p className="mt-0.5 whitespace-nowrap text-[13px] tabular-nums text-[#5b6573]">{r.qtyLine}</p>
                )}
                <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[#6b7684]">{r.note}</p>
              </div>
            </li>
          ))}
        </ul>

        {vat !== null && (
          <dl className="mt-5 space-y-1.5 border-t border-[#eef0f2] pt-4 text-[13px] text-[#5b6573]">
            <div className="flex justify-between">
              <dt>공급가액</dt>
              <dd className="tabular-nums">{won(supplyAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>부가세 (10%)</dt>
              <dd className="tabular-nums">{won(vat)}</dd>
            </div>
          </dl>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {GUARANTEES.map(({ text, Icon, tone }) => (
            <span
              key={text}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[12.5px] font-semibold ${tone}`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              {text}
            </span>
          ))}
        </div>

        <div className="mt-6 border-t border-[#eef0f2] pt-4 text-[12.5px] leading-[1.6] text-[#6b7684]">
          <p>
            {BUSINESS_NAME} · <span className="tabular-nums">{BUSINESS_PHONE}</span>
          </p>
          <p>본 견적은 현장 실측 결과에 따라 조정될 수 있습니다.</p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleShare}
        disabled={sharing}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-[16px] font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        <Share2 className="h-[18px] w-[18px]" strokeWidth={2} />
        {sharing ? "이미지 만드는 중..." : "견적서 이미지로 공유"}
      </button>

      {/* 스텔스 원가 분석 — 총액 더블 탭 / 길게 누르기로만 열린다. */}
      {stealthOpen && (
        <section className="fin-sheet rounded-[24px] bg-white p-5 text-[#191f28] shadow-[0_12px_32px_-12px_rgba(25,31,40,0.22)]">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[15px] font-bold text-orange-800">
              <Lock className="h-4 w-4" strokeWidth={2} />
              내부 분석
              <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[11px] font-semibold text-orange-700">고객 비공개</span>
            </h3>
            <button
              type="button"
              onClick={() => setStealthOpen(false)}
              aria-label="내부 분석 닫기"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f2f4f6] text-[#4e5968]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <dl className="mt-3 space-y-2.5 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-[#5b6573]">자재비</dt>
              <dd className="font-semibold tabular-nums">{won(materialTotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#5b6573]">부자재 / 경비</dt>
              <dd className="font-semibold tabular-nums">{won(expenseTotal)}</dd>
            </div>
            <div className="flex justify-between border-t border-[#eef0f2] pt-2.5">
              <dt className="text-[#5b6573]">원가 합계</dt>
              <dd className="font-bold tabular-nums">{won(costTotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#5b6573]">시공 마진</dt>
              <dd className="font-bold tabular-nums">
                {marginRate.toFixed(0)}% · {won(marginAmount)}
              </dd>
            </div>
          </dl>

          <label className="mt-4 flex items-center justify-between gap-3 border-t border-[#eef0f2] pt-4 text-[14px] text-[#5b6573]">
            협의 공급가액
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                step={10000}
                value={negotiated}
                placeholder={String(supplyAmount)}
                onChange={(e) => setNegotiated(e.target.value)}
                className="h-11 w-36 rounded-xl border border-[#d1d6db] bg-white px-3 text-right text-[16px] font-bold tabular-nums text-[#191f28] placeholder:font-normal placeholder:text-[#8b95a1]"
              />
              원
            </span>
          </label>

          <div className="mt-5 text-center">
            <p className="text-[13px] font-medium text-[#5b6573]">
              {negotiatedNum === null ? "예상 수익" : "협의가 기준 예상 수익"}
            </p>
            <p
              className={`mt-1 text-[32px] font-extrabold leading-none tracking-[-0.03em] tabular-nums ${
                (negotiatedMargin ?? marginAmount) < 0 ? "text-red-600" : "text-blue-600"
              }`}
            >
              {won(negotiatedMargin ?? marginAmount)}
            </p>
            {negotiatedNum !== null && discountRate !== null && (
              <p className="mt-2 text-[13px] tabular-nums text-[#5b6573]">
                할인 {discountRate.toFixed(1)}% · 마진율 {negotiatedRate === null ? "-" : `${negotiatedRate.toFixed(0)}%`}
                {negotiatedMargin !== null && negotiatedMargin < 0 ? " · 원가 미만" : ""}
              </p>
            )}
          </div>
        </section>
      )}

      <div className="flex items-center justify-between gap-3 px-1">
        <BusinessBadge onSecretHold={onSecretHold} />
      </div>

      {/* navigator.share를 못 쓰거나 실패했을 때의 안전한 대안. 기기 공유창이 열리지
          않아도 이미지가 화면에 보이고, 저장 → 전화번호 → 문자로 순서가 눈에 보인다. */}
      {shareFallback && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center foldLandscape:items-center foldLandscape:p-6">
          <button
            type="button"
            aria-label="닫기"
            onClick={closeShareFallback}
            className="absolute inset-0 cursor-default bg-black/45 animate-[fade-in_0.2s_ease-out]"
          />
          <div className="relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.18)] animate-[sheet-up_0.28s_cubic-bezier(0.32,0.72,0,1)] foldLandscape:rounded-[28px]">
            <div className="flex shrink-0 justify-center pt-3">
              <div className="h-1.5 w-11 rounded-full bg-[#e5e8eb]" />
            </div>
            <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-[18px] font-bold text-[#191f28]">
                {shareFallback.step === "preview" ? "견적서 이미지" : "문자로 보내기"}
              </h2>
              <button
                type="button"
                onClick={closeShareFallback}
                aria-label="닫기"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f2f4f6] text-[#4e5968]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
              {shareFallback.step === "preview" ? (
                <>
                  <p className="mb-3 text-[13px] leading-relaxed text-[#5b6573]">
                    공유창이 뜨지 않는 기기에서도 이 이미지를 저장해 카카오톡·문자로 바로 보낼 수 있습니다.
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL은 next/image가 다루지 못한다 */}
                  <img
                    src={shareFallback.url}
                    alt="견적서 캡처 이미지"
                    className="w-full rounded-2xl border border-[#eef0f2] shadow-[0_1px_2px_rgba(25,31,40,0.06)]"
                  />
                  {/* 버튼(자동 다운로드)이 기기에 따라 조용히 실패할 수 있어, 브라우저가
                      직접 지원하는 "이미지 길게 눌러 저장"을 항상 되는 방법으로 안내해 둔다. */}
                  <p className="mt-2 text-center text-[12px] text-[#8b95a1]">
                    저장 버튼이 안 되면 위 이미지를 길게 눌러 저장할 수도 있어요
                  </p>
                  <button
                    type="button"
                    onClick={handleSaveToGallery}
                    className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-[16px] font-bold text-white transition-transform active:scale-[0.98]"
                  >
                    {shareFallback.saved ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <Download className="h-[18px] w-[18px]" />}
                    {shareFallback.saved ? "갤러리에 저장됨" : "갤러리에 저장하기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareFallback((s) => (s ? { ...s, step: "phone" } : s))}
                    className="mt-2.5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#f2f4f6] text-[16px] font-bold text-[#191f28] transition-transform active:scale-[0.98]"
                  >
                    <MessageCircle className="h-[18px] w-[18px]" />
                    전화번호로 문자 보내기
                  </button>
                </>
              ) : (
                <>
                  <p className="mb-4 text-[13px] leading-relaxed text-[#5b6573]">
                    고객님 전화번호를 입력하면 문자 앱이 미리 채워진 문구와 함께 열립니다. 문자 앱에는 사진을
                    자동으로 첨부할 수 없으니, {shareFallback.saved ? "방금 저장한" : "저장할"} 이미지를 문자에서
                    직접 첨부해 주세요.
                  </p>
                  <label className="block">
                    <span className="text-[13px] font-semibold text-[#4e5968]">고객 전화번호</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoFocus
                      value={phone}
                      onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                      placeholder="010-1234-5678"
                      className="mt-2 h-14 w-full rounded-2xl border border-[#d1d6db] bg-white px-4 text-[18px] font-bold tabular-nums text-[#191f28] outline-none placeholder:font-normal placeholder:text-[#a8afb8] focus:border-indigo-500"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleSendSms}
                    disabled={phoneDigits.length < 9}
                    className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-[16px] font-bold text-white transition-transform active:scale-[0.98] disabled:bg-[#e5e8eb] disabled:text-[#a8afb8]"
                  >
                    <MessageCircle className="h-[18px] w-[18px]" />
                    문자 앱 열기
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareFallback((s) => (s ? { ...s, step: "preview" } : s))}
                    className="mx-auto mt-3 flex h-11 items-center px-4 text-[14px] text-[#5b6573]"
                  >
                    이미지로 돌아가기
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-28 left-1/2 z-[95] max-w-[88vw] -translate-x-1/2 whitespace-normal rounded-2xl bg-[#191f28] px-5 py-3 text-center text-[14px] font-semibold leading-snug text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
