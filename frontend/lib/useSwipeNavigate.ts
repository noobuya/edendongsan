"use client";

import { useRef } from "react";
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

/** 화면을 옆으로 쓸면 MENU_ORDER의 다음/이전 화면으로 넘어간다. 반환값을 스와이프를
 *  허용할 컨테이너(보통 화면 전체 배경)의 onPointerDown/onPointerUp에 펼쳐 쓴다.
 *  enabled가 false면(편집 모드 중, 카메라 열림 등) 아무 효과도 없다. */
export function useSwipeNavigate(currentPath: string, enabled = true) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled || isInteractive(e.target)) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onPointerUp(e: React.PointerEvent) {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId || !enabled) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE_PX) return;
    if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_VERTICAL_RATIO) return;
    const idx = MENU_ORDER.indexOf(currentPath);
    if (idx === -1) return;
    const nextIdx = dx < 0 ? (idx + 1) % MENU_ORDER.length : (idx - 1 + MENU_ORDER.length) % MENU_ORDER.length;
    router.push(MENU_ORDER[nextIdx]);
  }

  function onPointerCancel() {
    start.current = null;
  }

  return { onPointerDown, onPointerUp, onPointerCancel };
}
