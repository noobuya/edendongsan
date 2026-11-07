"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// [왜 — 2026-11-08 "화면을 옆으로 쓸어서 넘기면 다음 메뉴로 넘어가는 기술을
// 넣어줘"] 헤더 아이콘 줄과 같은 순서 — 왼쪽으로 쓸면 다음, 오른쪽으로 쓸면
// 이전으로 이동한다. 홈(/)도 포함해 어느 화면에서든 한 바퀴 돌 수 있다.
export const MENU_ORDER = [
  "/",
  "/quote",
  "/cutting",
  "/colors",
  "/blog",
  "/portfolio",
  "/community",
  "/automation",
  "/recruiting",
];

const SWIPE_MIN_DISTANCE_PX = 80;
// 수직으로 이만큼 더 많이 움직였으면 스크롤 의도로 보고 무시한다(가로 스와이프와
// 세로 스크롤을 헷갈리지 않게).
const SWIPE_MAX_VERTICAL_RATIO = 0.6;

/** 버튼·링크·입력창·슬라이더 위에서 시작한 드래그는 스와이프 내비게이션으로
 *  가로채지 않는다 — 평수 슬라이더(/quote)처럼 가로로 끄는 기존 조작과
 *  부딪히면 안 된다. */
function isInteractive(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest('button, a, input, textarea, select, [role="slider"], [data-no-swipe]');
}

/** 화면을 옆으로 쓸면 MENU_ORDER의 다음/이전 화면으로 넘어간다.
 *
 * [왜 — 2026-11-08 "스와이프 네비게이션이 안된다"] 처음엔 onPointerDown/
 * onPointerUp을 둘 다 React prop으로 <main>에 붙였는데, 손가락이 조금만
 * 비스듬히 움직여도 pointerup이 다른(더 안쪽) 엘리먼트 위에서 끝나버려
 * React 쪽 핸들러가 걸리지 않는 경우가 있었다. components/Movable.tsx가
 * 이미 쓰고 있는 "누르기 시작은 엘리먼트에서, 그다음(move/up/cancel)은
 * window에 붙여서 끝까지 받는다" 패턴을 그대로 가져왔다 — 이렇게 하면
 * 손끝이 화면 어디로 가든 반드시 끝까지 추적된다. */
export function useSwipeNavigate(currentPath: string, enabled = true) {
  const router = useRouter();
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    function handleUp(e: PointerEvent) {
      const s = start.current;
      start.current = null;
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      if (!s || s.id !== e.pointerId || !enabledRef.current) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < SWIPE_MIN_DISTANCE_PX) return;
      if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_VERTICAL_RATIO) return;
      const idx = MENU_ORDER.indexOf(currentPath);
      if (idx === -1) return;
      const nextIdx = dx < 0 ? (idx + 1) % MENU_ORDER.length : (idx - 1 + MENU_ORDER.length) % MENU_ORDER.length;
      router.push(MENU_ORDER[nextIdx]);
    }
    function handleCancel() {
      start.current = null;
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    }
    function onPointerDown(e: PointerEvent) {
      if (!enabledRef.current || isInteractive(e.target)) return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }, [currentPath, router]);
}
