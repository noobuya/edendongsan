"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, RefreshCw, X } from "lucide-react";

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
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [busy, setBusy] = useState(false);

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

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    ctx.drawImage(video, 0, 0);
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

  if (!open) return null;

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

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-contain" />

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
