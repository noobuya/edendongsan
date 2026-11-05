"use client";

import { useEffect, useRef, useState } from "react";
import { Droplet, Maximize2, RotateCcw } from "lucide-react";
import { DEFAULT_ADJUSTMENT, useLayoutEdit } from "@/components/LayoutEdit";
import type { LayoutAdjustment } from "@/lib/api";

const LONG_PRESS_MS = 420;
// 손가락이 이만큼 넘게 움직이면 "길게 누르기"가 아니라 "눌렀다 뗀 것"으로 보고
// 롱프레스 판정 자체를 취소한다 — 스크롤·탭과 헷갈리지 않게.
// [왜 2026-11-05에 10 → 26으로 올렸는가 — "설정 UI가 안 움직인다"] 손가락을
// 가만히 대고 있어도 자연스럽게 몇 px은 떨린다. 10px은 그 떨림만으로도 매번
// 판정이 취소돼, 길게 눌러도 거의 집히지 않는 원인이었다.
const MOVE_TOLERANCE_PX = 26;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const MIN_OPACITY = 0.15;

// 폴더를 접었을 때(세로)와 펼쳤을 때(가로, 가로폭 700px 이상 — tailwind.config의
// foldLandscape와 같은 기준)는 각 요소의 "원래 자리"를 나타내는 CSS 클래스 자체가
// 완전히 다르다(예: main-panel은 세로에서는 아래쪽에 붙는 작은 카드, 가로에서는
// 오른쪽에 붙는 사이드 패널). 같은 픽셀 보정값을 두 레이아웃에 똑같이 적용하면
// 기준점 자체가 다르니 펼쳤을 때 위치가 달라져 보인다(2026-11-05 "폴더를
// 열었을 때 위치가 달라진다") — 지문처럼 요소 id에 방향을 붙여 아예 다른 저장
// 칸을 쓰면, 세로에서 맞춘 배치와 가로에서 맞춘 배치가 서로 간섭하지 않는다.
function useOrientationSuffix(): string {
  const [suffix, setSuffix] = useState("portrait");
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (min-width: 700px)");
    const update = () => setSuffix(mq.matches ? "landscape" : "portrait");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return suffix;
}

export interface MovableResult {
  /** 지금 이 요소를 편집할 수 있는 상태인지(편집 모드 + 사장님 기기). */
  editable: boolean;
  /** 저장된 위치·크기·투명도 보정값 — 대상 요소의 style에 그대로 얹는다.
   *  [왜 투명도를 children만 따로 감싸지 않고 요소 전체에 얹는가] 감싸는 div를
   *  하나 더 넣으면 header-icons처럼 그 자체가 flex 컨테이너인 요소들의
   *  레이아웃이 깨진다(안쪽 아이콘들이 더 이상 flex item이 아니게 된다) —
   *  대신 편집 손잡이도 함께 옅어지는 쪽을 택했다. 최소 투명도(MIN_OPACITY)를
   *  0으로 두지 않아 손잡이가 아예 안 보이진 않는다. */
  style: React.CSSProperties;
  /** editable일 때만 포인터 핸들러가 들어있다(아니면 빈 객체) — 대상 요소에
   *  {...handlers}로 그대로 펼쳐 쓴다. */
  handlers: Partial<{
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  }>;
  /** 점선 테두리 + 크기 조절·투명도·초기화 손잡이. 대상 요소가 이미
   *  position:absolute/relative라서 그 자체로 손잡이의 위치 기준이 될 때만 쓸 수
   *  있다 — 아니라면 <Movable> 감싸개를 대신 쓴다. */
  overlay: React.ReactNode;
}

/** Movable(아래)과 같은 동작을 "감싸는 div 없이" 쓰고 싶을 때 — 대상 요소가 이미
 *  position:absolute인 경우(이미 자기 자신이 절대 위치 기준이라, 감싸는 div로
 *  relative를 한 번 더 두면 그 기준이 뒤바뀌어 레이아웃이 깨진다). 반환값을
 *  대상 요소의 className/style/핸들러에 직접 펼쳐 쓴다. */
export function useMovable(rawId: string): MovableResult {
  const { editMode, canEdit, get, update, commit, reset } = useLayoutEdit();
  const id = `${rawId}@${useOrientationSuffix()}`;
  const adjustment = get(id);
  const editable = editMode && canEdit;

  const [armed, setArmed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPress = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; baseDx: number; baseDy: number } | null>(
    null
  );
  const resizeState = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );
  const opacityState = useRef<{ pointerId: number; startY: number; baseOpacity: number } | null>(null);

  function clearPressTimer() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pendingPress.current = null;
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (resizeState.current || opacityState.current) return;
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

  // 모서리 손잡이 — 대각선으로 끌면 가로(scale_x)·세로(scale_y)가 각각 그 방향
  // 만큼만 바뀐다("가로세로 크기 따로 조정" 요청).
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
    resizeState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: adjustment.scale_x,
      baseY: adjustment.scale_y,
    };
  }

  function handleResizeMove(e: React.PointerEvent) {
    const resize = resizeState.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    const deltaX = (e.clientX - resize.startX) / 140;
    const deltaY = (e.clientY - resize.startY) / 140;
    update(id, {
      ...adjustment,
      scale_x: Math.min(MAX_SCALE, Math.max(MIN_SCALE, resize.baseX + deltaX)),
      scale_y: Math.min(MAX_SCALE, Math.max(MIN_SCALE, resize.baseY + deltaY)),
    });
  }

  function handleResizeEnd(e: React.PointerEvent) {
    const resize = resizeState.current;
    if (resize && resize.pointerId === e.pointerId) {
      commit(id, get(id));
      resizeState.current = null;
    }
  }

  // 왼쪽 아래 손잡이 — 위아래로 끌면 투명도가 바뀐다.
  function handleOpacityStart(e: React.PointerEvent) {
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
    opacityState.current = { pointerId: e.pointerId, startY: e.clientY, baseOpacity: adjustment.opacity };
  }

  function handleOpacityMove(e: React.PointerEvent) {
    const op = opacityState.current;
    if (!op || op.pointerId !== e.pointerId) return;
    // 위로 끌면 진하게(불투명), 아래로 끌면 투명하게 — 손잡이를 "끌어올린다"는
    // 직관과 맞춘다.
    const delta = (op.startY - e.clientY) / 160;
    update(id, { ...adjustment, opacity: Math.min(1, Math.max(MIN_OPACITY, op.baseOpacity + delta)) });
  }

  function handleOpacityEnd(e: React.PointerEvent) {
    const op = opacityState.current;
    if (op && op.pointerId === e.pointerId) {
      commit(id, get(id));
      opacityState.current = null;
    }
  }

  const hasCustomLayout =
    adjustment.dx !== 0 || adjustment.dy !== 0 || adjustment.scale_x !== 1 || adjustment.scale_y !== 1;
  const style: React.CSSProperties = {};
  if (hasCustomLayout) {
    style.transform = `translate(${adjustment.dx}px, ${adjustment.dy}px) scale(${adjustment.scale_x}, ${adjustment.scale_y})`;
  }
  if (adjustment.opacity !== 1) style.opacity = adjustment.opacity;
  if (editable) style.touchAction = "none";

  const handlers = editable
    ? {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: endDrag,
        onPointerCancel: handlePointerCancel,
      }
    : {};

  const hasAnyAdjustment = hasCustomLayout || adjustment.opacity !== 1;
  const overlay = editable ? (
    <>
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-2 rounded-2xl border-2 border-dashed transition-colors ${
          armed ? "border-emerald-400 bg-emerald-400/10" : "border-indigo-400"
        }`}
      />
      {/* 크기 — 대각선으로 끌면 가로·세로가 각각 그만큼 바뀐다. */}
      <button
        type="button"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        aria-label={`${rawId} 크기 조절(가로·세로 각각)`}
        style={{ touchAction: "none" }}
        className="absolute -bottom-3 -right-3 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg active:scale-95"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
      {/* 투명도 — 위아래로 끌면 바뀐다. */}
      <button
        type="button"
        onPointerDown={handleOpacityStart}
        onPointerMove={handleOpacityMove}
        onPointerUp={handleOpacityEnd}
        onPointerCancel={handleOpacityEnd}
        aria-label={`${rawId} 투명도 조절`}
        style={{ touchAction: "none" }}
        className="absolute -bottom-3 -left-3 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg active:scale-95"
      >
        <Droplet className="h-4 w-4" />
      </button>
      {hasAnyAdjustment && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            reset(id);
          }}
          aria-label={`${rawId} 원래대로`}
          className="absolute -top-3 -right-3 z-50 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg active:scale-95"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </>
  ) : null;

  return { editable, style, handlers, overlay };
}

/** 편집 모드에서 길게 누르면 집어서 옮기고, 모서리 손잡이로 크기(가로·세로 각각)와
 *  왼쪽 아래 손잡이로 투명도를 바꿀 수 있는 감싸개 — position:static인(원래 자기
 *  자리 기준이 없는) 요소에 쓴다. 이미 position:absolute인 요소(떠 있는 패널·
 *  뱃지 등)는 이 감싸개 대신 useMovable을 직접 써서 감싸는 div 없이 적용해야
 *  한다 — 그렇지 않으면 이 감싸개가 새로 만드는 위치 기준 때문에 원래의
 *  absolute 배치가 어긋난다(2026-11-05, 첫 시도에서 실제로 이 문제를 겪고
 *  useMovable을 분리했다). */
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
    <div className={`${className} ${editable ? "relative select-none" : ""}`} style={style} {...handlers}>
      {children}
      {overlay}
    </div>
  );
}
