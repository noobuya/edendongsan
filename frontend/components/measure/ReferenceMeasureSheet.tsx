"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw, X } from "lucide-react";
import CrosshairMagnifier from "@/components/measure/CrosshairMagnifier";

// ISO/IEC 7810 ID-1 규격(신용카드·신분증 공통 규격)의 긴 변. 전 세계 어디서나 지갑에
// 들어 있는 가장 구하기 쉬운 "정확한 기준 길이"라 이걸 기준 객체로 쓴다. AR(평면
// 인식·깊이 센서) 없이도, 카드와 측정 대상이 같은 평면(같은 벽/같은 거리)에 있으면
// 사진 속 픽셀 비율만으로 충분히 쓸 만한 정밀도가 나온다.
const REFERENCE_CARD_MM = 85.6;
const ROUND_STEP_MM = 10; // 스마트 재단 계산기와 같은 규칙 — 최종 확정값은 10mm 단위로 다듬는다

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

type Phase = "camera" | "calibrate" | "measure" | "confirm" | "error";

interface Point {
  /** 원본 사진의 실제 픽셀 좌표(naturalWidth 기준, 화면 표시 크기와 무관). */
  x: number;
  y: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** <img object-contain>은 엘리먼트 박스 전체(getBoundingClientRect)와 실제로 사진이
 *  그려지는 영역이 다르다 — 사진 비율과 화면 비율이 안 맞으면 위아래(또는 좌우)에
 *  레터박스가 생기기 때문이다. 탭 좌표를 사진의 실제 픽셀로 바꾸려면 레터박스를 뺀
 *  "진짜 그려진 사각형"이 기준이어야 한다. */
function containedImageRect(img: HTMLImageElement): { left: number; top: number; width: number; height: number } {
  const rect = img.getBoundingClientRect();
  const containerAspect = rect.width / rect.height;
  const imageAspect = img.naturalWidth / img.naturalHeight || containerAspect;
  if (imageAspect > containerAspect) {
    const height = rect.width / imageAspect;
    return { left: rect.left, top: rect.top + (rect.height - height) / 2, width: rect.width, height };
  }
  const width = rect.height * imageAspect;
  return { left: rect.left + (rect.width - width) / 2, top: rect.top, width, height: rect.height };
}

interface Props {
  open: boolean;
  /** "가로"/"세로" 등 — 안내 문구와 확정 후 호출부에 전달만 할 때 쓴다. */
  dimensionLabel: string;
  onConfirm: (mm: number) => void;
  onClose: () => void;
}

/** 기준 카드(신용카드 크기) 대조 방식의 실측 도구.
 *
 *  1) 카메라로 한 장 찍는다(이후 정지 사진 위에서만 작업 — 흔들리는 실시간 영상
 *     위에서 모서리를 짚으면 오차가 커진다).
 *  2) 기준 카드의 긴 변(85.6mm) 양 끝을 돋보기로 정밀하게 짚는다.
 *  3) 측정하려는 모서리 두 지점을 같은 방식으로 짚는다.
 *  4) ★ 수동 컨펌 — 계산된 값을 그대로 믿지 않고, 10mm 단위로 다듬은 값을 보여준
 *     뒤 기공이 직접 확인·수정하고 확정해야만 호출부에 전달된다. */
export default function ReferenceMeasureSheet({ open, dimensionLabel, onConfirm, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("camera");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [calibPoints, setCalibPoints] = useState<Point[]>([]);
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const [activePoint, setActivePoint] = useState<{ natural: Point; screenX: number; screenY: number } | null>(null);
  const [manualMm, setManualMm] = useState("");
  // streamRef(ref)만으로는 스트림이 도착해도 리렌더가 안 일어나 "촬영" 버튼이 계속
  // disabled로 보인다 — 화면에 쓰는 "준비됐나" 여부는 반드시 state로 따로 들고 있어야 한다.
  const [streamReady, setStreamReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  // toDataURL()은 전체 해상도 사진을 매번 다시 인코딩하는 무거운 연산이라, 돋보기가
  // 움직일 때마다(포인터 이동 = 리렌더) 새로 부르면 안 된다 — 촬영 직후 딱 한 번만
  // 만들어 상태에 담아 두고 <img src>는 그 값을 그대로 쓴다.
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreamReady(false);
  }

  // 시트를 열 때마다 처음부터 — 이전에 찍은 사진·점은 재사용하지 않는다(현장이 바뀌었을 수 있음).
  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }
    setPhase("camera");
    setErrorMessage(null);
    setCalibPoints([]);
    setMeasurePoints([]);
    setManualMm("");
    setPhotoDataUrl(null);
    setStreamReady(false);
    let cancelled = false;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        setStreamReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
        setErrorMessage("카메라를 열지 못했어요. 권한을 허용했는지 확인해 주세요.");
      });

    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function capture() {
    const video = videoRef.current;
    const canvas = photoCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    stopStream();
    setPhotoDataUrl(canvas.toDataURL("image/jpeg", 0.92));
    setPhase("calibrate");
  }

  function toNaturalPoint(clientX: number, clientY: number): Point | null {
    const img = imageRef.current;
    const canvas = photoCanvasRef.current;
    if (!img || !canvas || !img.naturalWidth) return null;
    const rect = containedImageRect(img); // 레터박스를 뺀 실제 사진 영역 기준
    const xRatio = (clientX - rect.left) / rect.width;
    const yRatio = (clientY - rect.top) / rect.height;
    if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return null;
    return { x: xRatio * canvas.width, y: yRatio * canvas.height };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const natural = toNaturalPoint(e.clientX, e.clientY);
    if (!natural) return;
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setActivePoint({ natural, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top });
  }

  function handleTap(e: React.PointerEvent) {
    const natural = toNaturalPoint(e.clientX, e.clientY);
    if (!natural) return;
    if (phase === "calibrate") {
      setCalibPoints((prev) => (prev.length >= 2 ? prev : [...prev, natural]));
    } else if (phase === "measure") {
      setMeasurePoints((prev) => (prev.length >= 2 ? prev : [...prev, natural]));
    }
  }

  const calibDistPx = calibPoints.length === 2 ? distance(calibPoints[0], calibPoints[1]) : 0;
  const mmPerPx = calibDistPx > 0 ? REFERENCE_CARD_MM / calibDistPx : 0;
  const measureDistPx = measurePoints.length === 2 ? distance(measurePoints[0], measurePoints[1]) : 0;
  const rawMm = measureDistPx * mmPerPx;
  const roundedMm = rawMm > 0 ? roundUpTo(rawMm, ROUND_STEP_MM) : 0;

  function goToMeasureStep() {
    setMeasurePoints([]);
    setPhase("measure");
  }
  function goToConfirmStep() {
    setManualMm(String(roundedMm));
    setPhase("confirm");
  }
  function confirm() {
    const value = Math.max(0, parseFloat(manualMm) || 0);
    onConfirm(value);
  }

  if (!open) return null;

  const instruction =
    phase === "camera"
      ? "측정할 부위와 기준 카드(신용카드 등)가 함께 보이게 촬영하세요"
      : phase === "calibrate"
        ? "기준 카드의 긴 변(85.6mm) 양 끝을 짚어주세요"
        : phase === "measure"
          ? `${dimensionLabel} 측정할 두 지점을 짚어주세요`
          : "";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
      <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white">
        <p className="text-[15px] font-bold">카드 대조 실측 — {dimensionLabel}</p>
        <button type="button" onClick={onClose} aria-label="닫기" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      {phase === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center text-white">
          <p className="text-[14px] leading-relaxed text-white/80">{errorMessage}</p>
          <button type="button" onClick={onClose} className="h-12 rounded-xl bg-white/10 px-6 text-[14px] font-semibold">
            닫고 직접 입력하기
          </button>
        </div>
      )}

      {phase === "camera" && (
        <div className="relative flex-1 overflow-hidden bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
          {!streamReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-white/70" />
            </div>
          )}
        </div>
      )}

      {phase !== "camera" && phase !== "error" && (
        <div
          className="relative flex-1 touch-none overflow-hidden bg-black"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActivePoint(null)}
          onPointerDown={handleTap}
        >
          {photoDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- 캔버스에서 바로 만든 data URL이라 next/image 대상이 아니다
            <img
              ref={imageRef}
              src={photoDataUrl}
              alt="측정 대상 사진"
              className="h-full w-full object-contain"
              draggable={false}
            />
          )}
          <PointOverlay img={imageRef.current} points={phase === "calibrate" ? calibPoints : measurePoints} color={phase === "calibrate" ? "#22d3ee" : "#6366f1"} />
          {activePoint && phase !== "confirm" && (
            <CrosshairMagnifier
              sourceCanvas={photoCanvasRef.current}
              naturalX={activePoint.natural.x}
              naturalY={activePoint.natural.y}
              anchorX={activePoint.screenX}
              anchorY={activePoint.screenY}
            />
          )}
        </div>
      )}

      {/* 캡처용 숨은 캔버스 — 원본 해상도 그대로 보관해 돋보기·거리 계산의 기준이 된다. */}
      <canvas ref={photoCanvasRef} className="hidden" />

      <div className="shrink-0 bg-black px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 text-white">
        {phase !== "confirm" && phase !== "error" && (
          <p className="mb-3 text-center text-[13px] leading-relaxed text-white/70">{instruction}</p>
        )}

        {phase === "camera" && (
          <button
            type="button"
            onClick={capture}
            disabled={!streamReady}
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-black disabled:opacity-40"
            aria-label="촬영"
          >
            <Camera className="h-6 w-6" />
          </button>
        )}

        {phase === "calibrate" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCalibPoints([])}
              disabled={calibPoints.length === 0}
              className="flex h-12 items-center gap-1.5 rounded-xl bg-white/10 px-4 text-[14px] font-semibold disabled:opacity-30"
            >
              <RotateCcw className="h-4 w-4" /> 다시 짚기
            </button>
            <button
              type="button"
              onClick={goToMeasureStep}
              disabled={calibPoints.length < 2}
              className="h-12 flex-1 rounded-xl bg-indigo-600 text-[15px] font-bold disabled:bg-white/10 disabled:text-white/30"
            >
              다음
            </button>
          </div>
        )}

        {phase === "measure" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMeasurePoints([])}
              disabled={measurePoints.length === 0}
              className="flex h-12 items-center gap-1.5 rounded-xl bg-white/10 px-4 text-[14px] font-semibold disabled:opacity-30"
            >
              <RotateCcw className="h-4 w-4" /> 다시 짚기
            </button>
            <button
              type="button"
              onClick={goToConfirmStep}
              disabled={measurePoints.length < 2}
              className="h-12 flex-1 rounded-xl bg-indigo-600 text-[15px] font-bold disabled:bg-white/10 disabled:text-white/30"
            >
              계산하기
            </button>
          </div>
        )}

        {phase === "confirm" && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="text-[12.5px] text-white/60">
                사진에서 계산한 값 · 10mm 단위로 다듬었어요. 틀리면 직접 고치고 확정하세요.
              </p>
              <p className="mt-1 text-[13px] tabular-nums text-white/40">원본 계산값 {rawMm.toFixed(1)}mm</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={manualMm}
                  onChange={(e) => setManualMm(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="h-14 w-full rounded-xl border border-white/20 bg-white/10 px-4 text-center text-[24px] font-extrabold tabular-nums text-white outline-none focus:border-indigo-400"
                />
                <span className="text-[15px] font-semibold text-white/60">mm</span>
              </div>
            </div>
            <button type="button" onClick={confirm} className="h-14 w-full rounded-2xl bg-indigo-600 text-[16px] font-bold">
              이 값으로 확정
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 이미 짚은 점(들)을 사진 위에 작은 원 + 번호로 표시하고, 두 점이면 선도 잇는다.
 *  이 SVG는 img와 같은 부모 안에서 꽉 채워 absolute로 깔리므로(둘 다 h-full w-full),
 *  SVG 좌표 원점은 img의 엘리먼트 박스 원점과 같다 — 거기서 레터박스 오프셋만큼만
 *  밀어주면 된다. */
function PointOverlay({ img, points, color }: { img: HTMLImageElement | null; points: Point[]; color: string }) {
  if (!img || points.length === 0 || !img.naturalWidth) return null;
  const outer = img.getBoundingClientRect();
  const inner = containedImageRect(img);
  const offsetX = inner.left - outer.left;
  const offsetY = inner.top - outer.top;
  const toScreen = (p: Point) => ({
    x: offsetX + (p.x / img.naturalWidth) * inner.width,
    y: offsetY + (p.y / img.naturalHeight) * inner.height,
  });
  const screenPoints = points.map(toScreen);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {screenPoints.length === 2 && (
        <line x1={screenPoints[0].x} y1={screenPoints[0].y} x2={screenPoints[1].x} y2={screenPoints[1].y} stroke={color} strokeWidth={2} />
      )}
      {screenPoints.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={6} fill={color} stroke="white" strokeWidth={2} />
        </g>
      ))}
    </svg>
  );
}
