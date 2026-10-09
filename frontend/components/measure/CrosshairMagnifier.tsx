"use client";

import { useEffect, useRef } from "react";

const LOUPE_SIZE_PX = 132;
const ZOOM = 3;

/** 모서리를 정밀하게 짚기 위한 돋보기 — 손가락에 가려지는 지점을 확대해 화면
 *  위쪽에 띄워 보여준다. 원본 사진을 들고 있는 캔버스(sourceCanvas)에서 터치
 *  지점 주변을 그대로 오려내 확대하므로, 화면에 표시된 사진이 CSS로 줄어들어
 *  있어도(실제 해상도는 그대로) 배율이 어긋나지 않는다. */
export default function CrosshairMagnifier({
  sourceCanvas,
  naturalX,
  naturalY,
  anchorX,
  anchorY,
}: {
  sourceCanvas: HTMLCanvasElement | null;
  /** 돋보기로 보여줄 지점 — 원본 사진의 실제 픽셀 좌표(화면 표시 크기가 아니라 naturalWidth 기준). */
  naturalX: number;
  naturalY: number;
  /** 돋보기 원을 띄울 화면 좌표(보통 터치 지점 바로 위, 손가락에 가리지 않게). */
  anchorX: number;
  anchorY: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const src = sourceCanvas;
    const dst = canvasRef.current;
    if (!src || !dst) return;
    const ctx = dst.getContext("2d");
    if (!ctx) return;

    const cropSize = LOUPE_SIZE_PX / ZOOM;
    const sx = Math.max(0, Math.min(src.width - cropSize, naturalX - cropSize / 2));
    const sy = Math.max(0, Math.min(src.height - cropSize, naturalY - cropSize / 2));

    ctx.clearRect(0, 0, LOUPE_SIZE_PX, LOUPE_SIZE_PX);
    ctx.imageSmoothingEnabled = false; // 확대해서 보는 용도라, 부드럽게 뭉개지 않고 픽셀이 또렷해야 모서리를 짚기 쉽다
    ctx.drawImage(src, sx, sy, cropSize, cropSize, 0, 0, LOUPE_SIZE_PX, LOUPE_SIZE_PX);
  }, [sourceCanvas, naturalX, naturalY]);

  return (
    <div
      className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-2 border-white shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
      style={{
        width: LOUPE_SIZE_PX,
        height: LOUPE_SIZE_PX,
        left: anchorX - LOUPE_SIZE_PX / 2,
        top: anchorY - LOUPE_SIZE_PX - 24, // 손가락/터치 지점 위쪽으로 띄워 가리지 않게
      }}
    >
      <canvas ref={canvasRef} width={LOUPE_SIZE_PX} height={LOUPE_SIZE_PX} />
      {/* 십자선 — 돋보기 한가운데가 곧 실제로 찍히는 지점이다 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-red-500/70" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-red-500/70" />
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-red-500" />
      </div>
    </div>
  );
}
