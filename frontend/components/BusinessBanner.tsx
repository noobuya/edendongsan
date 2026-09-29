"use client";

import { useRef, useState } from "react";
import { Phone } from "lucide-react";
import { BUSINESS_NAME, BUSINESS_PHONE, BUSINESS_PHONE_TEL_HREF } from "@/lib/businessInfo";

const HOLD_MS = 3000;
// 손가락은 가만히 있어도 미세하게 흔들린다. 이 정도 움직임까지는 "누르고 있는
// 중"으로 본다(넘어가면 스크롤 의도로 보고 취소).
const MOVE_TOLERANCE_PX = 12;

interface Props {
  /** 3초간 길게 눌렀을 때 — 단가 설정(개발자 모드)을 연다.
   *  공개 페이지(시공 후기 블로그)에서는 넘기지 않아 길게 눌러도 아무 일도 없다. */
  onSecretHold?: () => void;
}

/** 업체 표기는 폼 안에 끼워 넣지 않고, 화면 구석에 워터마크처럼 조용히 둔다.
 *  고객에게 보여주는 화면이라 상호는 늘 보이되 조작을 방해하면 안 된다.
 *
 *  3초간 누르고 있으면 단가 설정이 열린다 — 고객 앞에서는 그냥 상호 뱃지로만
 *  보여야 하므로 버튼이나 메뉴로 드러내지 않는다.
 *
 *  [왜 <a>가 아니라 <button>인가]
 *  안드로이드 WebView는 링크(<a>)를 길게 누르면 시스템 메뉴(전화/복사/공유)를
 *  띄우면서 pointercancel을 발생시킨다. 그래서 링크로 두면 폰에서만 3초 타이머가
 *  매번 취소돼 단가 설정이 열리지 않는다(PC 브라우저에서는 잘 열려서 더 헷갈린다).
 *  버튼으로 두고 전화 걸기는 짧게 눌렀을 때 직접 실행한다. */
export default function BusinessBadge({ onSecretHold }: Props = {}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const [holding, setHolding] = useState(false);

  function startHold(e: React.PointerEvent<HTMLButtonElement>) {
    firedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    if (!onSecretHold) return;
    setHolding(true);
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setHolding(false);
      onSecretHold();
    }, HOLD_MS);
  }

  function cancelHold() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  }

  function handleMove(e: React.PointerEvent<HTMLButtonElement>) {
    const start = startRef.current;
    if (!start || !timerRef.current) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX) cancelHold();
  }

  function handlePointerUp() {
    const wasHeld = firedRef.current;
    cancelHold();
    startRef.current = null;
    // 길게 눌러 설정을 연 경우에는 전화가 이어서 걸리면 안 된다.
    if (!wasHeld) window.location.href = BUSINESS_PHONE_TEL_HREF;
    firedRef.current = false;
  }

  return (
    <button
      type="button"
      onPointerDown={startHold}
      onPointerMove={handleMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${BUSINESS_NAME} ${BUSINESS_PHONE}`}
      // WebKit/안드로이드가 길게 누를 때 띄우는 미리보기·선택 UI를 막는다.
      style={{ WebkitTouchCallout: "none", touchAction: "manipulation" }}
      className="glass-pill relative flex select-none items-center gap-2.5 overflow-hidden px-4 py-2.5 text-left transition-transform active:scale-95"
    >
      {/* 누르고 있는 동안 차오르는 막대 — 뭔가 진행 중이라는 신호만 주고,
          무엇이 열리는지는 알리지 않는다. */}
      <span
        className={`pointer-events-none absolute inset-y-0 left-0 bg-indigo-500/15 ${
          holding ? "w-full" : "w-0"
        }`}
        style={{ transition: holding ? `width ${HOLD_MS}ms linear` : "none" }}
      />
      <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white">
        <Phone className="h-3 w-3" />
      </span>
      <span className="relative leading-tight">
        <span className="block text-[11px] font-bold tracking-tight text-slate-900">{BUSINESS_NAME}</span>
        <span className="block text-[11px] font-light tabular-nums text-slate-500">{BUSINESS_PHONE}</span>
      </span>
    </button>
  );
}
