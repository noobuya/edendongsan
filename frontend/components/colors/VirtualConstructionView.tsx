"use client";

import { useEffect, useRef, useState } from "react";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import { Camera, ChevronDown, Images, Loader2, Phone, RotateCcw, Sparkles } from "lucide-react";
import { useBusinessInfo } from "@/lib/businessInfo";

export type MaterialTexture = "solid" | "wood" | "metal";

export interface VirtualConstructionPick {
  brand: string;
  code: string;
  name: string;
  approxHex: string;
  /** [왜] 실제 제품 스펙(광택도 측정값)이 없어 이름으로 추론한 값이다(예:
   *  "메탈"/"스테인리스" 포함 → metal). 추론이라고 명확히 표시해 둔다 —
   *  나중에 진짜 제품 DB에 광택 스펙이 생기면 이 값을 거기서 받아야 한다. */
  texture: MaterialTexture;
  glossiness: number; // 0(완전 무광)~100(고광택) 추정치
}

export interface VirtualConstructionViewProps {
  /** 지금 가상 시공을 시연할 자재(색+질감) — 색상 플래너에서 고른 값을 그대로 받는다. */
  pick: VirtualConstructionPick;
  /** 안내 문구·로딩 문구에 쓸 부위명(예: "샷시", "방문"). */
  partLabel: string;
  /** 함께 보여줄 스마트 견적 총액(있으면 결과 화면 하단에 이어 붙인다). */
  quoteTotal?: number | null;
}

type Stage = "upload" | "detecting" | "select" | "processing" | "result";

/** 사진 위에서 "매직 터치"로 탭할 수 있는 영역 — 0~1 비율 좌표라 사진 크기에
 *  안 묶인다. 실제로는 백엔드가 사진마다 다르게 찾아 보내준다(아래 설명). */
interface DetectedRegion {
  id: string;
  label: string;
  box: { x: number; y: number; w: number; h: number };
}

/** 백엔드로 보낼 재질 데이터 — HEX만 보내지 않고 질감·광택·실제 품번까지
 *  함께 보낸다(사장님이 요구한 페이로드 규격 그대로). */
interface MaterialPayload {
  mask_id: string;
  color: string;
  texture: MaterialTexture;
  glossiness: number;
  brand_code: string;
}

function processingMessages(regionLabel: string, pick: VirtualConstructionPick): string[] {
  return [
    `AI가 고객님 댁의 ${regionLabel}에 ${pick.name}(${pick.brand} ${pick.code})을 정밀 시공하고 있습니다...`,
    "기존 질감을 지우고 있습니다...",
    "빛 반사와 그림자를 계산 중입니다...",
    "조명 톤을 맞춰 자연스럽게 섞는 중입니다...",
  ];
}

// [왜 — Mock, 2026-11-09 "매직 터치 + 재질 치환 통합"] 실제로는 백엔드가
// SAM(Meta sam-2, Replicate)으로 사진 속 후보 영역을 전부 뽑고 Gemini Vision으로
// "이게 방문/샷시/싱크대 중 뭔지" 분류해 보내준다 — 이 코드베이스엔 이미
// backend/app/services/segmentation.py에 그 파이프라인이 있다(SAM_TIMEOUT_S=90,
// VISION_TIMEOUT_S=30 — 사진 한 장당 최대 2분 가까이 걸리고 Replicate·Gemini
// 호출 비용이 든다). 다만 거긴 "견적을 낸 job 사진"을 대상으로 하고, 여긴
// 고객이 그 자리에서 아무 사진이나 올리는 빠른 데모 용도라 그 비용·시간을
// 쓰지 않는다 — 대신 일반적인 사진 구도를 가정한 고정 위치 3곳을 "인식된 것
// 처럼" 보여준다. 실제 인식이 아니라는 걸 라벨·안내문으로 분명히 밝힌다.
function mockDetectRegions(): DetectedRegion[] {
  return [
    { id: "door_1", label: "방문(추정)", box: { x: 0.05, y: 0.16, w: 0.26, h: 0.62 } },
    { id: "sash_1", label: "샷시(추정)", box: { x: 0.64, y: 0.08, w: 0.32, h: 0.4 } },
    { id: "sink_1", label: "싱크대 하부장(추정)", box: { x: 0.34, y: 0.64, w: 0.32, h: 0.24 } },
  ];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
    img.src = src;
  });
}

/** [왜 — 이 함수는 지금 Mock이다]
 *  사장님이 요구한 3단계(Flattening/Material Mapping/Relighting)를 캔버스
 *  2D로 "흉내"만 낸다 — 선택한 영역만 블러해 기존 결·광택을 뭉개고(flatten),
 *  재질 종류에 따라 다른 패턴을 겹치고(material mapping), 전체 밝기는 그대로
 *  둔다(relighting 흉내 — 실제 조명 재추정은 없음). 진짜 사진 합성이 아니므로
 *  "데모" 라벨을 항상 같이 띄운다.
 *
 *  진짜로 만들려면 무엇이 필요한지는 컴포넌트 밖 — 대화에 적은 아키텍처
 *  설명을 참고(요약: 이 캔버스 블러+오버레이로는 "진짜 질감"이 안 나온다,
 *  생성형 모델이나 최소한 절차적 텍스처 합성이 필요하다). */
async function mockGenerateVirtualConstruction(photoUrl: string, region: DetectedRegion, payload: MaterialPayload): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 2800));

  const img = await loadImage(photoUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return photoUrl;
  ctx.drawImage(img, 0, 0);

  const rx = region.box.x * canvas.width;
  const ry = region.box.y * canvas.height;
  const rw = region.box.w * canvas.width;
  const rh = region.box.h * canvas.height;

  // 1) Flattening(흉내) — 선택 영역만 블러해 기존 나뭇결/광택을 뭉갠다.
  //    모서리 음영 같은 "형태"는 블러 정도를 약하게 둬서 완전히 지워지진 않게 함.
  const patch = document.createElement("canvas");
  patch.width = Math.max(1, Math.round(rw));
  patch.height = Math.max(1, Math.round(rh));
  const pctx = patch.getContext("2d");
  if (pctx) {
    pctx.filter = "blur(5px)";
    pctx.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);
    ctx.drawImage(patch, rx, ry, rw, rh);
  }

  // 2) Material Mapping(흉내) — 재질 종류별로 다른 겹치기.
  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();

  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = payload.color;
  ctx.globalAlpha = payload.texture === "metal" ? 0.35 : 0.5;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  if (payload.texture === "wood") {
    // 세로 결 느낌의 가는 줄무늬 — 진짜 나뭇결이 아니라 방향성만 흉내.
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = "#000000";
    for (let x = rx + 4; x < rx + rw; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(x) * 2, ry);
      ctx.lineTo(x - Math.sin(x) * 2, ry + rh);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (payload.texture === "metal") {
    // 헤어라인 메탈 느낌의 대각선 하이라이트 줄무늬 + 약한 스페큘러 밴드.
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#ffffff";
    for (let x = rx - rh; x < rx + rw; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x, ry + rh);
      ctx.lineTo(x + rh, ry);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const grad = ctx.createLinearGradient(rx, ry, rx + rw, ry + rh);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, `rgba(255,255,255,${0.1 + payload.glossiness / 400})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.restore();

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? URL.createObjectURL(blob) : photoUrl),
      "image/jpeg",
      0.92
    );
  });
}

export default function VirtualConstructionView({ pick, partLabel, quoteTotal }: VirtualConstructionViewProps) {
  const business = useBusinessInfo();
  const [stage, setStage] = useState<Stage>("upload");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [regions, setRegions] = useState<DetectedRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<DetectedRegion | null>(null);
  const [lastPayload, setLastPayload] = useState<MaterialPayload | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [msgIndex, setMsgIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      if (resultUrl && resultUrl !== photoUrl) URL.revokeObjectURL(resultUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
    setError(null);
  }

  // 1단계 → 매직 터치: 사진을 올리면 바로 "부위 인식 중" → 인식된 부위를
  // 점선/형광 오버레이로 띄운 뒤 고객이 탭해서 고르게 한다.
  async function startDetecting() {
    if (!photoUrl) return;
    setStage("detecting");
    await new Promise((r) => setTimeout(r, 1100));
    setRegions(mockDetectRegions());
    setStage("select");
  }

  async function selectRegionAndRender(region: DetectedRegion) {
    setSelectedRegion(region);
    const payload: MaterialPayload = {
      mask_id: region.id,
      color: pick.approxHex,
      texture: pick.texture,
      glossiness: pick.glossiness,
      brand_code: `${pick.brand} ${pick.code}`,
    };
    setLastPayload(payload);
    setStage("processing");
    setError(null);
    setMsgIndex(0);
    const messages = processingMessages(region.label.replace("(추정)", ""), pick);
    const interval = setInterval(() => setMsgIndex((i) => (i + 1) % messages.length), 1200);
    try {
      if (!photoUrl) throw new Error("사진이 없습니다.");
      const after = await mockGenerateVirtualConstruction(photoUrl, region, payload);
      setResultUrl(after);
      setStage("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "가상 시공에 실패했습니다.");
      setStage("select");
    } finally {
      clearInterval(interval);
    }
  }

  function reset() {
    if (resultUrl && resultUrl !== photoUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setSelectedRegion(null);
    setRegions([]);
    setStage("upload");
  }

  const messages = selectedRegion ? processingMessages(selectedRegion.label.replace("(추정)", ""), pick) : [];

  return (
    <div className="rounded-2xl bg-[#f8f9fa] p-4">
      <p className="text-[12.5px] font-bold text-indigo-600">AI 가상 시공 — 매직 터치 (실제 사진 합성)</p>

      {/* 1단계: 현장 사진 업로드 */}
      {stage === "upload" && (
        <div className="mt-3">
          <p className="text-[13px] leading-relaxed text-[#5b6573]">
            시공할 부위({partLabel})가 보이는 실제 사진을 올려주세요. AI가 시공 가능한 부위를 찾아 표시해 드리고, 그 자리를 톡
            누르면 선택한{" "}
            <b>
              {pick.brand} {pick.code}({pick.name})
            </b>
            을 그 부위에 가상으로 입혀 보여드립니다.
          </p>

          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />

          {!photoUrl ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#d1d6db] bg-white text-[#8b95a1] active:scale-[0.99]"
            >
              <span className="flex gap-3">
                <Camera className="h-7 w-7" strokeWidth={1.75} />
                <Images className="h-7 w-7" strokeWidth={1.75} />
              </span>
              <span className="text-[13px] font-bold">사진 촬영 또는 갤러리에서 선택</span>
            </button>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt="업로드한 현장 사진" className="aspect-[4/3] w-full object-cover" />
            </div>
          )}

          {error && <p className="mt-2 text-[12.5px] font-semibold text-rose-600">{error}</p>}

          <div className="mt-3 flex gap-2">
            {photoUrl && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-12 rounded-2xl bg-white px-4 text-[13.5px] font-bold text-[#4e5968]"
              >
                다시 선택
              </button>
            )}
            <button
              type="button"
              onClick={startDetecting}
              disabled={!photoUrl}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 text-[15px] font-bold text-white disabled:bg-[#d1d6db]"
            >
              <Sparkles className="h-4 w-4" strokeWidth={2.25} />
              매직 터치로 부위 찾기
            </button>
          </div>
        </div>
      )}

      {/* 2단계: 부위 인식 중 */}
      {stage === "detecting" && photoUrl && (
        <div className="relative mt-3 aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#0b0d12]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/30 px-6 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-white" strokeWidth={2} />
            <p className="text-[13.5px] font-semibold text-white">AI가 시공 가능한 부위를 인식하고 있습니다...</p>
          </div>
        </div>
      )}

      {/* 2단계: 매직 터치 — 인식된 부위를 점선/형광 오버레이로 표시, 탭해서 선택 */}
      {stage === "select" && photoUrl && (
        <div className="mt-3">
          <p className="text-[12.5px] font-semibold text-[#5b6573]">
            시공 부위가 인식되었습니다. 색을 입힐 부위를 톡 눌러 주세요.
          </p>
          <div className="relative mt-2 aspect-[4/3] w-full overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="업로드한 현장 사진" className="absolute inset-0 h-full w-full object-cover" />
            {regions.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => selectRegionAndRender(r)}
                className="absolute flex items-center justify-center rounded-md border-2 border-dashed border-amber-300 bg-amber-300/15 shadow-[0_0_0_2px_rgba(252,211,77,0.25)] [animation:magictouch-pulse_1.6s_ease-in-out_infinite] active:scale-[0.97]"
                style={{
                  left: `${r.box.x * 100}%`,
                  top: `${r.box.y * 100}%`,
                  width: `${r.box.w * 100}%`,
                  height: `${r.box.h * 100}%`,
                }}
              >
                <span className="rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-bold text-amber-200">{r.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#8b95a1]">
            데모용 인식 위치입니다 — 실제로는 사진마다 AI(SAM)가 다르게 찾아 보여줍니다.
          </p>
          <style jsx>{`
            @keyframes magictouch-pulse {
              0%,
              100% {
                opacity: 0.55;
              }
              50% {
                opacity: 1;
              }
            }
          `}</style>
        </div>
      )}

      {/* 3단계: AI 시공 중 로딩 */}
      {stage === "processing" && (
        <div className="relative mt-3 aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#0b0d12]">
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 px-6 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-white" strokeWidth={2} />
            <p className="text-[13.5px] font-semibold leading-relaxed text-white">{messages[msgIndex]}</p>
          </div>
        </div>
      )}

      {/* 4단계: 비포/애프터 슬라이더 + 전송 데이터 + 자재/견적/실측신청 */}
      {stage === "result" && photoUrl && resultUrl && (
        <div className="mt-3">
          <div className="overflow-hidden rounded-xl">
            <ReactCompareSlider
              itemOne={<ReactCompareSliderImage src={photoUrl} alt="시공 전" />}
              itemTwo={<ReactCompareSliderImage src={resultUrl} alt="시공 후" />}
              style={{ aspectRatio: "4 / 3" }}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#8b95a1]">
            데모용 미리보기입니다 — 질감·조명까지 반영한 정밀 합성은 아직 연동 전입니다. 가운데 바를 좌우로 끌어 비교해 보세요.
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-4 py-3">
            <span className="h-6 w-6 shrink-0 rounded-full border border-black/5" style={{ backgroundColor: pick.approxHex }} />
            <span className="text-[13.5px] font-bold text-[#191f28]">
              적용 품번 — {pick.brand} {pick.code} ({pick.name})
            </span>
          </div>

          {lastPayload && (
            <div className="mt-2 rounded-xl bg-white px-4 py-3">
              <button
                type="button"
                onClick={() => setShowPayload((v) => !v)}
                className="flex w-full items-center justify-between text-[12px] font-bold text-[#8b95a1]"
              >
                백엔드로 보낸 데이터
                <ChevronDown className={`h-4 w-4 transition-transform ${showPayload ? "rotate-180" : ""}`} strokeWidth={2} />
              </button>
              {showPayload && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-[#0b0d12] p-3 text-[11px] text-emerald-300">
                  {JSON.stringify(lastPayload, null, 2)}
                </pre>
              )}
            </div>
          )}

          {typeof quoteTotal === "number" && (
            <div className="mt-2 rounded-xl bg-indigo-600 px-4 py-3 text-white">
              <p className="text-[12px] font-bold text-indigo-200">스마트 견적 (방문·샷시·싱크대 기준)</p>
              <p className="text-[22px] font-extrabold tracking-tight">{quoteTotal.toLocaleString("ko-KR")}원</p>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="flex h-12 items-center gap-1.5 rounded-2xl bg-white px-4 text-[13.5px] font-bold text-[#4e5968]"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
              다시 찍기
            </button>
            <a
              href={business.phoneTelHref}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 text-[15px] font-bold text-white"
            >
              <Phone className="h-4 w-4" strokeWidth={2.25} />
              방문 실측 신청하기
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
