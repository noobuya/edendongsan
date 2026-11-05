"use client";

import { useRef, useState } from "react";
import { Maximize2, RotateCcw } from "lucide-react";
import { useLayoutEdit } from "@/components/LayoutEdit";

const LONG_PRESS_MS = 420;
// 손가락이 이만큼 넘게 움직이면 "길게 누르기"가 아니라 "눌렀다 뗀 것"으로 보고
// 롱프레스 판정 자체를 취소한다 — 스크롤·탭과 헷갈리지 않게.
const MOVE_TOLERANCE_PX = 10;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

export interface MovableResult {
  /** 지금 이 요소를 편집할 수 있는 상태인지(편집 모드 + 사장님 기기). */
  editable: boolean;
  /** 저장된 위치·크기 보정값 — 대상 요소의 style에 그대로 얹는다. */
  style: React.CSSProperties;
  /** editable일 때만 포인터 핸들러가 들어있다(아니면 빈 객체) — 대상 요소에
   *  {...handlers}로 그대로 펼쳐 쓴다. */
  handlers: Partial<{
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  }>;
  /** 점선 테두리 + 크기 조절·초기화 손잡이. 대상 요소가 이미 position:absolute/
   *  relative라서 그 자체로 손잡이의 위치 기준이 될 때만 쓸 수 있다 — 아니라면
   *  <Movable> 감싸개를 대신 쓴다. */
  overlay: React.ReactNode;
}

/** Movable(아래)과 같은 동작을 "감싸는 div 없이" 쓰고 싶을 때 — 대상 요소가 이미
 *  position:absolute인 경우(이미 자기 자신이 절대 위치 기준이라, 감싸는 div로
 *  relative를 한 번 더 두면 그 기준이 뒤바뀌어 레이아웃이 깨진다). 반환값을
 *  대상 요소의 className/style/핸들러에 직접 펼쳐 쓴다. */
export function useMovable(id: string): MovableResult {
  const { editMode, canEdit, get, update, commit, reset } = useLayoutEdit();
  const adjustment = get(id);
  const editable = editMode && canEdit;

  const [armed, setArmed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPress = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; baseDx: number; baseDy: number } | null>(
    null
  );
  const resizeState = useRef<{ pointerId: number; startX: number; baseScale: number } | null>(null);

  function clearPressTimer() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pendingPress.current = null;
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (resizeState.current) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const baseDx = adjustment.dx;
    const baseDy = adjustment.dy;
    clearPressTimer();
    pendingPress.current = { pointerId, startX, startY };
    pressTimer.current = setTimeout(() => {
      pendingPress.current = null;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* 이미 떼어졌으면 무시 */
      }
      dragState.current = { pointerId, startX, startY, baseDx, baseDy };
      setArmed(true);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const pending = pendingPress.current;
    if (pending && pending.pointerId === e.pointerId) {
      const moved = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (moved > MOVE_TOLERANCE_PX) clearPressTimer();
      return;
    }
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    update(id, {
      ...adjustment,
      dx: drag.baseDx + (e.clientX - drag.startX),
      dy: drag.baseDy + (e.clientY - drag.startY),
    });
  }

  function endDrag(e: React.PointerEvent) {
    clearPressTimer();
    const drag = dragState.current;
    if (drag && drag.pointerId === e.pointerId) {
      commit(id, get(id));
      dragState.current = null;
    }
    setArmed(false);
  }

  function handlePointerCancel() {
    clearPressTimer();
    dragState.current = null;
    setArmed(false);
  }

  function handleResizeStart(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    clearPressTimer();
    dragState.current = null;
    setArmed(false);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    resizeState.current = { pointerId: e.pointerId, startX: e.clientX, baseScale: adjustment.scale };
  }

  function handleResizeMove(e: React.PointerEvent) {
    const resize = resizeState.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    const delta = (e.clientX - resize.startX) / 140;
    update(id, { ...adjustment, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, resize.baseScale + delta)) });
  }

  function handleResizeEnd(e: React.PointerEvent) {
    const resize = resizeState.current;
    if (resize && resize.pointerId === e.pointerId) {
      commit(id, get(id));
      resizeState.current = null;
    }
  }

  const hasCustomLayout = adjustment.dx !== 0 || adjustment.dy !== 0 || adjustment.scale !== 1;
  const style: React.CSSProperties = hasCustomLayout
    ? { transform: `translate(${adjustment.dx}px, ${adjustment.dy}px) scale(${adjustment.scale})` }
    : {};

  const handlers = editable
    ? {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: endDrag,
        onPointerCancel: handlePointerCancel,
      }
    : {};

  const overlay = editable ? (
    <>
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-2 rounded-2xl border-2 border-dashed transition-colors ${
          armed ? "border-emerald-400 bg-emerald-400/10" : "border-indigo-400"
        }`}
      />
      <button
        type="button"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        aria-label={`${id} 크기 조절`}
        className="absolute -bottom-3 -right-3 z-50 flex h-9 w-9 touch-none items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg active:scale-95"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
      {hasCustomLayout && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            reset(id);
          }}
          aria-label={`${id} 원래대로`}
          className="absolute -top-3 -right-3 z-50 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg active:scale-95"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </>
  ) : null;

  return { editable, style, handlers, overlay };
}

/** 편집 모드에서 길게 누르면 집어서 옮기고, 모서리 손잡이로 크기를 바꿀 수 있는
 *  감싸개 — position:static인(원래 자기 자리 기준이 없는) 요소에 쓴다. 이미
 *  position:absolute인 요소(떠 있는 패널·뱃지 등)는 이 감싸개 대신 useMovable을
 *  직접 써서 감싸는 div 없이 적용해야 한다 — 그렇지 않으면 이 감싸개가 새로
 *  만드는 위치 기준 때문에 원래의 absolute 배치가 어긋난다(2026-11-05, 첫
 *  시도에서 실제로 이 문제를 겪고 useMovable을 분리했다). */
export default function Movable({
  id,
  children,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { editable, style, handlers, overlay } = useMovable(id);
  return (
    <div className={`${className} ${editable ? "relative touch-none select-none" : ""}`} style={style} {...handlers}>
      {children}
      {overlay}
    </div>
  );
}
