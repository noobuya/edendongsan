"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, Loader2, Save, Trash2, Undo2 } from "lucide-react";
import { fetchAssetObjectUrl, saveEditedImage } from "@/lib/api";
import SwatchPicker from "@/components/ui/SwatchPicker";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";

interface Point {
  x: number;
  y: number;
}

/** 유리 한 장처럼 따로 다루고 싶은 구역. corners는 좌상 → 우상 → 우하 → 좌하 순서이며
 *  네 점을 각각 옮길 수 있어 사진 속 원근에 맞춘 사다리꼴/평행사변형이 된다. */
interface Sector {
  id: string;
  corners: Point[];
  scale: number;
  colorHex: string | null;
  colorAlpha: number;
}

type Drag =
  | { kind: "draw"; start: Point; current: Point }
  | { kind: "corner"; index: number }
  | { kind: "edge"; index: number; last: Point }
  | { kind: "move"; last: Point };

// 핸들은 화면(CSS) 기준 크기로 그려야 사진 해상도와 무관하게 손가락으로 잡을 수 있다.
const HANDLE_RADIUS_CSS = 9;
const GRAB_SLOP_CSS = 20;
const MIN_SECTOR_SIDE = 16;
const DEFAULT_COLOR_ALPHA = 0.45;

interface Props {
  jobId: string;
  imageUrl: string;
  onSaved: (renderedImageUrl: string) => void;
}

export default function SectorEditor({ jobId, imageUrl, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setReady(false);
    setLoadError(null);

    fetchAssetObjectUrl(imageUrl)
      .then(
        (url) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            objectUrl = url;
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
            img.src = url;
          })
      )
      .then((img) => {
        if (cancelled) return;
        imageRef.current = img;
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
        }
        setReady(true);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "이미지를 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl]);

  // 사진이 바뀌면(다시 AI 렌더링 등) 이전 구역은 좌표 기준이 달라지므로 비운다.
  useEffect(() => {
    setSectors([]);
    setSelectedId(null);
    setSavedAt(false);
  }, [imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    drawScene(canvas, imageRef.current, sectors, selectedId, drag, cssToImageRatio(canvas));
  }, [ready, sectors, selectedId, drag]);

  const selected = sectors.find((s) => s.id === selectedId) ?? null;

  function toImagePoint(e: React.PointerEvent<HTMLCanvasElement>): Point | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const point = toImagePoint(e);
    if (!canvas || !point) return;
    canvas.setPointerCapture(e.pointerId);
    setSavedAt(false);

    const slop = GRAB_SLOP_CSS * cssToImageRatio(canvas);

    // 선택된 구역의 핸들을 가장 먼저 살핀다 — 구역이 겹쳐 있어도 지금 만지던
    // 구역을 계속 다룰 수 있어야 하기 때문이다.
    if (selected) {
      const cornerIndex = selected.corners.findIndex((c) => distance(c, point) <= slop);
      if (cornerIndex >= 0) {
        setDrag({ kind: "corner", index: cornerIndex });
        return;
      }
      const edgeIndex = selected.corners.findIndex(
        (_, i) => distance(edgeMidpoint(selected.corners, i), point) <= slop
      );
      if (edgeIndex >= 0) {
        setDrag({ kind: "edge", index: edgeIndex, last: point });
        return;
      }
    }

    const hit = [...sectors].reverse().find((s) => pointInQuad(point, s.corners));
    if (hit) {
      setSelectedId(hit.id);
      setDrag({ kind: "move", last: point });
      return;
    }

    setSelectedId(null);
    setDrag({ kind: "draw", start: point, current: point });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const point = toImagePoint(e);
    if (!point) return;

    if (drag.kind === "draw") {
      setDrag({ ...drag, current: point });
      return;
    }
    if (!selectedId) return;

    if (drag.kind === "corner") {
      updateSector(selectedId, (s) => ({
        ...s,
        corners: s.corners.map((c, i) => (i === drag.index ? point : c)),
      }));
      return;
    }

    const dx = point.x - drag.last.x;
    const dy = point.y - drag.last.y;

    if (drag.kind === "edge") {
      // 변 손잡이는 그 변의 양 끝점을 함께 옮긴다 — 윗변만 좌우로 밀면 평행사변형이,
      // 위아래로 올리면 문 높이에 맞는 사다리꼴이 된다.
      const a = drag.index;
      const b = (drag.index + 1) % 4;
      updateSector(selectedId, (s) => ({
        ...s,
        corners: s.corners.map((c, i) => (i === a || i === b ? { x: c.x + dx, y: c.y + dy } : c)),
      }));
    } else {
      updateSector(selectedId, (s) => ({
        ...s,
        corners: s.corners.map((c) => ({ x: c.x + dx, y: c.y + dy })),
      }));
    }
    setDrag({ ...drag, last: point });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (drag?.kind === "draw") {
      const { start, current } = drag;
      const x0 = Math.min(start.x, current.x);
      const y0 = Math.min(start.y, current.y);
      const x1 = Math.max(start.x, current.x);
      const y1 = Math.max(start.y, current.y);
      if (x1 - x0 >= MIN_SECTOR_SIDE && y1 - y0 >= MIN_SECTOR_SIDE) {
        const corners = [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ];
        const sector: Sector = {
          id: `sector-${Date.now()}`,
          corners,
          scale: 1,
          colorHex: null,
          colorAlpha: DEFAULT_COLOR_ALPHA,
        };
        setSectors((prev) => [...prev, sector]);
        setSelectedId(sector.id);
      }
    }
    setDrag(null);
  }

  function updateSector(id: string, updater: (s: Sector) => Sector) {
    setSectors((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }

  async function handleSave() {
    const img = imageRef.current;
    if (!img || sectors.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const output = document.createElement("canvas");
      output.width = img.naturalWidth;
      output.height = img.naturalHeight;
      // 저장본에는 구역 테두리/핸들 같은 편집 보조선을 그리지 않는다.
      drawScene(output, img, sectors, null, null, 1, false);
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("편집 결과 이미지를 만들지 못했습니다.");
      const { rendered_image_url } = await saveEditedImage(jobId, blob);
      setSavedAt(true);
      onSaved(rendered_image_url);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const selectedIndex = selected ? sectors.findIndex((s) => s.id === selected.id) + 1 : 0;

  return (
    <div>
      <div className="relative bg-slate-100">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          // 캔버스에서 손가락을 끌 때 페이지가 같이 스크롤되면 구역을 그릴 수 없다.
          className="w-full touch-none select-none"
          style={{ cursor: drag ? "grabbing" : "crosshair" }}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 px-4 text-center text-sm text-slate-400">
            {loadError ? <span className="text-red-500">{loadError}</span> : "이미지를 불러오는 중..."}
          </div>
        )}

        {/* [사진 위에 늘 떠 있는 조작 막대]
            예전에는 구역을 하나라도 그린 뒤에야 아래쪽에 삭제·저장 버튼이 나타났다.
            그래서 편집 탭에 들어가면 사진만 덩그러니 보이고 "무엇을 눌러야 하는지",
            "잘못 그린 걸 어떻게 지우는지"가 화면에 없었다. 도구는 항상 보여야 한다. */}
        {ready && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-center gap-1.5 bg-gradient-to-t from-black/45 to-transparent p-2.5">
            <span className="rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
              {selected ? `구역 ${selectedIndex} 선택됨` : "드래그해 구역 그리기"}
            </span>
            {selected && (
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="pointer-events-auto rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-transform active:scale-95"
              >
                선택 해제
              </button>
            )}
            {selected && (
              <button
                type="button"
                onClick={() => {
                  setSectors((prev) => prev.filter((s) => s.id !== selected.id));
                  setSelectedId(null);
                }}
                className="pointer-events-auto flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-transform active:scale-95"
              >
                <Trash2 className="h-3.5 w-3.5" />
                이 구역 삭제
              </button>
            )}
            {sectors.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSectors((prev) => prev.slice(0, -1));
                    setSelectedId(null);
                  }}
                  className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-transform active:scale-95"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  되돌리기
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="pointer-events-auto flex items-center gap-1 rounded-full bg-indigo-600 px-3.5 py-1.5 text-[11px] font-semibold text-white transition-transform active:scale-95 disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "저장 중..." : "적용"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-slate-200 bg-white p-3.5">
        <p className="text-xs text-slate-500">
          사진 위에서 <span className="font-medium text-slate-700">드래그해 유리 한 장씩 구역을 그리세요.</span> 구역을
          누르면 <span className="font-medium text-slate-700">모서리 4개</span>로 원근을 맞추고,{" "}
          <span className="font-medium text-slate-700">변 가운데 손잡이</span>로 위·아래·좌·우 변을 통째로 밀어 문틀에
          맞출 수 있습니다.
        </p>

        {sectors.length === 0 ? (
          <p className="rounded-md bg-slate-50 px-3 py-2.5 text-center text-xs text-slate-400">
            아직 그린 구역이 없습니다
          </p>
        ) : selected ? (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">구역 {selectedIndex}</span>
              <button
                type="button"
                onClick={() => {
                  setSectors((prev) => prev.filter((s) => s.id !== selected.id));
                  setSelectedId(null);
                }}
                className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" /> 구역 삭제
              </button>
            </div>

            <label className="block space-y-1">
              <span className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>구역 안 그림 크기</span>
                <span className="tabular-nums text-slate-700">{Math.round(selected.scale * 100)}%</span>
              </span>
              <input
                type="range"
                min={30}
                max={250}
                value={Math.round(selected.scale * 100)}
                onChange={(e) =>
                  updateSector(selected.id, (s) => ({ ...s, scale: Number(e.target.value) / 100 }))
                }
                className="w-full accent-blue-600"
              />
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-500">구역 색상 (썬팅 색)</span>
              <SwatchPicker
                swatches={ALL_PATTERN_SWATCHES}
                selectedId={ALL_PATTERN_SWATCHES.find((p) => p.colorHex === selected.colorHex)?.id}
                onSelect={(id) =>
                  updateSector(selected.id, (s) => ({
                    ...s,
                    colorHex: ALL_PATTERN_SWATCHES.find((p) => p.id === id)?.colorHex ?? null,
                  }))
                }
                size="sm"
              />
            </div>

            {selected.colorHex && (
              <>
                <label className="block space-y-1">
                  <span className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>색 농도</span>
                    <span className="tabular-nums text-slate-700">
                      {Math.round(selected.colorAlpha * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={Math.round(selected.colorAlpha * 100)}
                    onChange={(e) =>
                      updateSector(selected.id, (s) => ({ ...s, colorAlpha: Number(e.target.value) / 100 }))
                    }
                    className="w-full accent-blue-600"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => updateSector(selected.id, (s) => ({ ...s, colorHex: null }))}
                  className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
                >
                  <Eraser className="h-3.5 w-3.5" /> 색 지우기
                </button>
              </>
            )}
          </div>
        ) : (
          <p className="rounded-md bg-slate-50 px-3 py-2.5 text-center text-xs text-slate-400">
            구역 {sectors.length}개 · 편집할 구역을 사진에서 눌러 선택하세요
          </p>
        )}

        {saveError && (
          <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-600">{saveError}</p>
        )}
        {savedAt && !saveError && (
          <p className="text-center text-xs font-medium text-green-600">
            편집 결과를 시공 후 사진으로 저장했습니다
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setSectors([]);
              setSelectedId(null);
            }}
            disabled={sectors.length === 0 || saving}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            전체 지우기
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={sectors.length === 0 || saving || !ready}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "저장 중..." : "이 편집 결과를 시공 후 사진으로 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function cssToImageRatio(canvas: HTMLCanvasElement): number {
  const rect = canvas.getBoundingClientRect();
  return rect.width ? canvas.width / rect.width : 1;
}

function drawScene(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement | null,
  sectors: Sector[],
  selectedId: string | null,
  drag: Drag | null,
  handleRatio: number,
  withGuides = true
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !img) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  for (const sector of sectors) {
    const center = quadCenter(sector.corners);

    ctx.save();
    // 1) 구역 밖으로는 아무것도 넘치지 않게 자른다.
    traceQuad(ctx, sector.corners);
    ctx.clip();

    // 2) 그림을 줄이면 구역 안에 빈 자리가 생긴다. 같은 구역 내용을 아주 세게
    //    흐리게 깔아 채운다 — 단색으로 채우면 유리가 아니라 페인트칠한 판처럼
    //    보이는데, 강한 블러는 원래 그림은 알아볼 수 없게 뭉개면서 유리의 색과
    //    밝기 변화는 남겨서 빈 유리처럼 보인다.
    if (sector.scale < 1) {
      ctx.filter = `blur(${Math.max(12, quadShortSide(sector.corners) * 0.12)}px)`;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.filter = "none";
    }

    // 3) 좌표계를 구역 중심 기준으로 확대/축소한 뒤 "구역 모양"으로 한 번 더 자른다.
    //    이렇게 하면 잘리는 범위와 그려지는 사진이 똑같이 변형되어, 구역 안에 원래
    //    있던 내용만 그대로 줄거나 커진다. (예전에는 사진 전체를 축소해 그리는 바람에
    //    구역 안에 문틀·보도블록까지 딸려 들어왔다.)
    ctx.translate(center.x, center.y);
    ctx.scale(sector.scale, sector.scale);
    ctx.translate(-center.x, -center.y);
    traceQuad(ctx, sector.corners);
    ctx.clip();
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (sector.colorHex) {
      ctx.save();
      traceQuad(ctx, sector.corners);
      ctx.clip();
      ctx.globalAlpha = sector.colorAlpha;
      ctx.fillStyle = sector.colorHex;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  if (!withGuides) return;

  for (const sector of sectors) {
    const isSelected = sector.id === selectedId;
    ctx.save();
    traceQuad(ctx, sector.corners);
    ctx.strokeStyle = isSelected ? "#2563eb" : "rgba(37, 99, 235, 0.45)";
    ctx.lineWidth = (isSelected ? 2.5 : 1.5) * handleRatio;
    ctx.stroke();
    ctx.restore();

    if (!isSelected) continue;

    // 모서리(사각형)와 변 가운데(원형) 손잡이를 구분해 그린다 — 모양이 다르면
    // "점을 옮기는 것"과 "변을 통째로 미는 것"을 눌러보지 않고도 알 수 있다.
    for (const corner of sector.corners) {
      const r = HANDLE_RADIUS_CSS * handleRatio;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2 * handleRatio;
      ctx.beginPath();
      ctx.rect(corner.x - r, corner.y - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const mid = edgeMidpoint(sector.corners, i);
      const r = HANDLE_RADIUS_CSS * handleRatio * 0.85;
      ctx.fillStyle = "#2563eb";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * handleRatio;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (drag?.kind === "draw") {
    ctx.save();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2 * handleRatio;
    ctx.setLineDash([8 * handleRatio, 6 * handleRatio]);
    ctx.strokeRect(
      Math.min(drag.start.x, drag.current.x),
      Math.min(drag.start.y, drag.current.y),
      Math.abs(drag.current.x - drag.start.x),
      Math.abs(drag.current.y - drag.start.y)
    );
    ctx.restore();
  }
}

function traceQuad(ctx: CanvasRenderingContext2D, corners: Point[]) {
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
}

function quadShortSide(corners: Point[]): number {
  const sides = corners.map((c, i) => distance(c, corners[(i + 1) % corners.length]));
  return Math.min(...sides);
}

function quadCenter(corners: Point[]): Point {
  return {
    x: corners.reduce((sum, c) => sum + c.x, 0) / corners.length,
    y: corners.reduce((sum, c) => sum + c.y, 0) / corners.length,
  };
}

function edgeMidpoint(corners: Point[], index: number): Point {
  const a = corners[index];
  const b = corners[(index + 1) % corners.length];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInQuad(point: Point, corners: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i];
    const b = corners[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
