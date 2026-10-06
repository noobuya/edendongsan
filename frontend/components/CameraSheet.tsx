"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, RefreshCw, X } from "lucide-react";
import { PhotoGuideSheet, PhotoGuideTip } from "@/components/PhotoGuide";

interface Props {
  open: boolean;
  onCapture: (file: File) => void;
  onClose: () => void;
  /** 카메라를 못 쓸 때(권한 거부·카메라 없음) 파일 선택으로 넘어가는 대체 수단. */
  onPickFile: () => void;
}

/** 앱 안에서 직접 촬영하는 카메라 화면.
 *
 *  예전에는 <input capture="environment">로 안드로이드 기본 카메라 앱을 띄웠는데,
 *  그러면 촬영한 사진이 매번 폰 갤러리(DCIM)에 그대로 저장된다 — 견적을 낼 때마다
 *  사진이 쌓여 갤러리가 알 수 없는 사진으로 가득 찬다. 여기서는 카메라 영상을 직접
 *  받아 캔버스로 한 장 떠서 메모리에서 바로 업로드하므로, 폰에는 아무것도 남지 않는다. */
export default function CameraSheet({ open, onCapture, onClose, onPickFile }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  // hardware=true면 카메라 자체 광학/센서 줌, false면 화면 확대 + 촬영 시 중앙 잘라내기(디지털 줌).
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; hardware: boolean }>({
    min: 1,
    max: 4,
    hardware: false,
  });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const capsRef = useRef(zoomCaps);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const zoomRef = useRef(1);

  const applyZoom = useCallback((value: number) => {
    const { min, max, hardware } = capsRef.current;
    const z = Math.min(max, Math.max(min, value));
    zoomRef.current = z;
    setZoom(z);
    if (hardware) {
      trackRef.current
        ?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] })
        .catch(() => {});
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("이 기기에서는 앱 내 카메라를 쓸 수 없습니다.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        const caps = (track?.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number } };
        const next = caps.zoom
          ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 10), hardware: true }
          : { min: 1, max: 4, hardware: false };
        capsRef.current = next;
        setZoomCaps(next);
        zoomRef.current = Math.max(1, next.min);
        setZoom(zoomRef.current);
        if (next.hardware) {
          await track?.applyConstraints({ advanced: [{ zoom: zoomRef.current } as MediaTrackConstraintSet] }).catch(() => {});
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "카메라 권한이 거부되었습니다. 휴대폰 설정에서 이 앱의 카메라 권한을 켜주세요."
            : "카메라를 열지 못했습니다. 아래에서 사진을 선택해주세요."
        );
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, facing, stopStream]);

  function handleShutter() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);

    // 디지털 줌이면 화면에서 보이는 중앙 영역만 잘라 저장한다(하드웨어 줌은 이미 영상에 반영됨).
    const digital = !capsRef.current.hardware && zoomRef.current > 1;
    const sw = digital ? video.videoWidth / zoomRef.current : video.videoWidth;
    const sh = digital ? video.videoHeight / zoomRef.current : video.videoHeight;
    const sx = (video.videoWidth - sw) / 2;
    const sy = (video.videoHeight - sh) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        setBusy(false);
        if (!blob) return;
        onCapture(new File([blob], `site-${Date.now()}.jpg`, { type: "image/jpeg" }));
        stopStream();
        onClose();
      },
      "image/jpeg",
      0.92
    );
  }

  function touchDist(e: React.TouchEvent) {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) pinchRef.current = { dist: touchDist(e), zoom: zoomRef.current };
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2 || !pinchRef.current) return;
    applyZoom(pinchRef.current.zoom * (touchDist(e) / pinchRef.current.dist));
  }

  function handleWheel(e: React.WheelEvent) {
    applyZoom(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }

  if (!open) return null;

  const presets = [0.5, 1, 2, 4].filter((z) => z >= zoomCaps.min - 0.01 && z <= zoomCaps.max + 0.01);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black animate-[fade-in_0.2s_ease-out]">
      <div className="flex shrink-0 items-center justify-between px-5 pt-5">
        <button
          type="button"
          onClick={() => {
            stopStream();
            onClose();
          }}
          aria-label="닫기"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-transform active:scale-90"
        >
          <X className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          aria-label="카메라 전환"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-transform active:scale-90"
        >
          <RefreshCw className="h-5 w-5" />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => (pinchRef.current = null)}
        onWheel={handleWheel}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-contain"
          style={!zoomCaps.hardware && zoom > 1 ? { transform: `scale(${zoom})` } : undefined}
        />

        {!error && (
          <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-3 px-6">
            <div className="flex items-center gap-1 rounded-full bg-black/45 p-1 backdrop-blur-sm">
              {presets.map((z) => {
                const active = Math.abs(zoom - z) < 0.15;
                return (
                  <button
                    key={z}
                    type="button"
                    onClick={() => applyZoom(z)}
                    className={`flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-[13px] font-bold tabular-nums transition-colors ${
                      active ? "bg-white text-slate-900" : "text-white/85"
                    }`}
                  >
                    {z}x
                  </button>
                );
              })}
              <span className="px-2 text-[13px] font-bold tabular-nums text-white">{zoom.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              aria-label="줌"
              min={zoomCaps.min}
              max={zoomCaps.max}
              step={0.1}
              value={zoom}
              onChange={(e) => applyZoom(Number(e.target.value))}
              className="h-11 w-full max-w-xs accent-white"
            />
          </div>
        )}

        {/* 구도 가이드 — 벽·천장이 프레임에 다 들어오게 잡아준다. */}
        {!error && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="border border-white/15" />
              ))}
            </div>
          </div>
        )}

        {/* 촬영 안내 — 문 손잡이와 테두리가 정면에서 보여야 AI가 문짝 경계를 정확히 잡는다. */}
        {!error && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
            <PhotoGuideTip onOpenExample={() => setExampleOpen(true)} className="max-w-sm" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
              <Camera className="h-9 w-9 text-white/60" strokeWidth={1.5} />
            </span>
            <p className="text-[15px] leading-relaxed text-white/80">{error}</p>
            <button
              type="button"
              onClick={() => {
                stopStream();
                onClose();
                onPickFile();
              }}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-[15px] font-bold text-slate-900 transition-transform active:scale-[0.98]"
            >
              <ImagePlus className="h-5 w-5" />
              앨범에서 선택
            </button>
          </div>
        )}
      </div>

      <PhotoGuideSheet open={exampleOpen} onClose={() => setExampleOpen(false)} />

      <div className="flex shrink-0 items-center justify-center pb-safe pt-6">
        <button
          type="button"
          onClick={handleShutter}
          disabled={!!error || busy}
          aria-label="촬영"
          className="flex h-20 w-20 items-center justify-center rounded-full bg-white/25 ring-4 ring-white/70 transition-transform active:scale-90 disabled:opacity-40"
        >
          <span className="h-16 w-16 rounded-full bg-white" />
        </button>
      </div>
    </div>
  );
}
