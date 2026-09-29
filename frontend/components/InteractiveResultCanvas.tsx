"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchAssetObjectUrl } from "@/lib/api";
import type { Region } from "@/types";

interface RegionCache {
  region: Region;
  mask: ImageData;
  /** 캔버스 좌표계 기준 bbox. 백엔드 bbox는 "원본 사진" 크기 기준인데, AI 인페인팅
   *  결과물은 64의 배수로 반올림돼 크기가 달라질 수 있어(예: 683→704) 그대로 쓰면
   *  선택 테두리/배지가 어긋난다. 캔버스에 맞춰 그린 마스크에서 직접 계산한다. */
  bbox: [number, number, number, number];
}

interface Props {
  imageUrl: string;
  regions: Region[];
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string | null, label: string | null) => void;
  editingRegionId?: string | null;
}

export default function InteractiveResultCanvas({
  imageUrl,
  regions,
  selectedRegionId,
  onSelectRegion,
  editingRegionId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseImgRef = useRef<HTMLImageElement | null>(null);
  const regionCacheRef = useRef<RegionCache[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLoadError(null);
    // 그린 이미지를 나중에 다시 그릴 때(선택 테두리 갱신 등)도 쓸 수 있어야 하므로
    // blob URL은 이 이펙트가 살아있는 동안 유지했다가 정리 단계에서 한꺼번에 푼다.
    const objectUrls: string[] = [];

    async function loadAsset(path: string): Promise<HTMLImageElement> {
      const objectUrl = await fetchAssetObjectUrl(path);
      objectUrls.push(objectUrl);
      return decodeImage(objectUrl);
    }

    (async () => {
      try {
        const baseImg = await loadAsset(imageUrl);
        if (cancelled) return;
        baseImgRef.current = baseImg;

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = baseImg.naturalWidth;
        canvas.height = baseImg.naturalHeight;
        setNaturalSize({ w: baseImg.naturalWidth, h: baseImg.naturalHeight });

        const caches: RegionCache[] = [];
        for (const region of regions) {
          try {
            const maskImg = await loadAsset(region.mask_url);
            const off = document.createElement("canvas");
            off.width = canvas.width;
            off.height = canvas.height;
            const octx = off.getContext("2d");
            if (!octx) continue;
            octx.drawImage(maskImg, 0, 0, off.width, off.height);
            const mask = octx.getImageData(0, 0, off.width, off.height);
            const bbox = computeMaskBBox(mask);
            if (!bbox) continue; // 흰 픽셀이 없는 빈 마스크는 클릭 대상에서 제외
            caches.push({ region, mask, bbox });
          } catch {
            // 마스크 로드 실패 시 해당 부위는 클릭 대상에서 제외하고 계속 진행
          }
        }
        if (cancelled) return;
        regionCacheRef.current = caches;
        drawSelection(canvas, editingRegionId ? null : selectedRegionId);
        setReady(true);
      } catch (err) {
        // 예전엔 여기서 조용히 실패해 "이미지를 불러오는 중..."이 영원히 떠 있었다.
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "이미지를 불러오지 못했습니다.");
      }
    })();

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, regions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    // 편집(AI 렌더링) 중에는 점선 선택 테두리를 숨긴다 — 아래 컴팩트 배지
    // 하나로만 상태를 보여줘서 큰 영역(벽 등)에서 테두리+배지가 겹쳐
    // "정체불명의 큰 박스"처럼 보이지 않게 한다.
    if (canvas && ready) drawSelection(canvas, editingRegionId ? null : selectedRegionId);
  }, [selectedRegionId, editingRegionId, ready]);

  function drawSelection(canvas: HTMLCanvasElement, regionId: string | null) {
    const ctx = canvas.getContext("2d");
    const baseImg = baseImgRef.current;
    if (!ctx || !baseImg) return;
    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
    if (!regionId) return;
    const active = regionCacheRef.current.find((r) => r.region.id === regionId);
    if (!active) return;
    const [x, y, w, h] = active.bbox;
    ctx.save();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = Math.max(2, canvas.width * 0.004);
    ctx.setLineDash([canvas.width * 0.012, canvas.width * 0.008]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function pointerToCanvasCoords(e: React.MouseEvent<HTMLCanvasElement>): [number, number] | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
    return [x, y];
  }

  function hitTest(x: number, y: number): RegionCache | null {
    const matches = regionCacheRef.current.filter(({ mask }) => sampleMask(mask, x, y));
    if (matches.length === 0) return null;
    matches.sort((a, b) => bboxArea(a.bbox) - bboxArea(b.bbox));
    return matches[0];
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!ready || editingRegionId) return;
    const coords = pointerToCanvasCoords(e);
    const hit = coords ? hitTest(...coords) : null;
    onSelectRegion(hit ? hit.region.id : null, hit ? hit.region.label : null);
  }

  function handleMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!ready) return;
    const coords = pointerToCanvasCoords(e);
    const hit = coords ? hitTest(...coords) : null;
    setHoverLabel(hit ? hit.region.label : null);
  }

  const editingCache = editingRegionId
    ? regionCacheRef.current.find((r) => r.region.id === editingRegionId)
    : undefined;

  return (
    <div className="relative overflow-hidden rounded-lg bg-slate-100">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverLabel(null)}
        className={`w-full ${editingRegionId ? "cursor-wait" : "cursor-crosshair"}`}
      />
      {hoverLabel && !editingRegionId && (
        <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-slate-900/80 px-2 py-1 text-xs text-white">
          {hoverLabel} · 클릭해서 선택
        </span>
      )}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 px-4 text-center text-sm text-slate-400">
          {loadError ? <span className="text-red-500">{loadError}</span> : "이미지를 불러오는 중..."}
        </div>
      )}
      {ready && regionCacheRef.current.length === 0 && (
        <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-slate-400">
          클릭 가능한 부위를 찾지 못했습니다
        </span>
      )}
      {editingCache && naturalSize && (
        <>
          {/* 점선으로 편집 대상 영역의 위치만 얇게 표시 — 색은 채우지 않는다 */}
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-dashed border-blue-400/70"
            style={{
              left: `${(editingCache.bbox[0] / naturalSize.w) * 100}%`,
              top: `${(editingCache.bbox[1] / naturalSize.h) * 100}%`,
              width: `${(editingCache.bbox[2] / naturalSize.w) * 100}%`,
              height: `${(editingCache.bbox[3] / naturalSize.h) * 100}%`,
            }}
          />
          {/* 진행 상태는 영역 전체를 덮지 않는 작은 배지 하나로만 보여준다 */}
          <div
            className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-1.5 shadow-lg"
            style={{
              left: `${((editingCache.bbox[0] + editingCache.bbox[2] / 2) / naturalSize.w) * 100}%`,
              top: `${((editingCache.bbox[1] + editingCache.bbox[3] / 2) / naturalSize.h) * 100}%`,
            }}
          >
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white" />
            <span className="whitespace-nowrap text-[11px] font-medium text-white">AI 극사실 렌더링 중...</span>
          </div>
        </>
      )}
    </div>
  );
}

/** blob URL은 같은 출처로 취급되므로 캔버스가 오염되지 않아 getImageData()가 그대로
 *  동작한다 — 예전 crossOrigin="anonymous" + CORS 헤더 의존이 필요 없어졌다. */
function decodeImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    img.src = objectUrl;
  });
}

/** 캔버스 크기에 맞춰 그려진 마스크에서 흰 영역의 bbox를 직접 계산한다.
 *  (백엔드 bbox는 원본 사진 크기 기준이라 AI 결과물 크기와 어긋날 수 있다) */
function computeMaskBBox(mask: ImageData): [number, number, number, number] | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[(y * mask.width + x) * 4] > 127) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return [minX, minY, maxX - minX, maxY - minY];
}

function sampleMask(mask: ImageData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const idx = (y * mask.width + x) * 4;
  return mask.data[idx] > 127; // 그레이스케일 마스크의 R 채널을 밝기 값으로 사용
}

function bboxArea(bbox: [number, number, number, number]): number {
  return bbox[2] * bbox[3];
}
