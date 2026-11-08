"use client";

import { useEffect, useRef, useState } from "react";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import { Camera, Images, Loader2, Phone, RotateCcw } from "lucide-react";
import { useBusinessInfo } from "@/lib/businessInfo";

export interface VirtualConstructionPick {
  brand: string;
  code: string;
  name: string;
  approxHex: string;
}

export interface VirtualConstructionViewProps {
  /** 지금 가상 시공을 시연할 자재(색) — 색상 플래너에서 고른 값을 그대로 받는다. */
  pick: VirtualConstructionPick;
  /** 안내 문구·로딩 문구에 쓸 부위명(예: "샷시", "방문"). */
  partLabel: string;
  /** 함께 보여줄 스마트 견적 총액(있으면 결과 화면 하단에 이어 붙인다). */
  quoteTotal?: number | null;
}

type Stage = "upload" | "processing" | "result";

function processingMessages(partLabel: string, pick: VirtualConstructionPick): string[] {
  return [
    `AI가 고객님 댁의 ${partLabel}에 ${pick.name}(${pick.brand} ${pick.code})을 정밀 시공하고 있습니다...`,
    "빛 반사와 그림자를 계산 중입니다...",
    "질감과 경계선을 다듬고 있습니다...",
  ];
}

/** [왜 — 이 함수는 지금 Mock이다, 2026-11-09]
 *  사장님이 "백엔드 AI 이미지 생성 API는 연동되어 있다고 가정하고 프론트만"
 *  요청해서, 실제 합성 호출 자리를 이 함수 하나로 분리해 뒀다 — 나중에 진짜
 *  백엔드가 생기면 이 함수 내부만 fetch로 바꾸면 되고 나머지 UI는 그대로 쓴다.
 *
 *  지금은 실제로 AI 합성을 하지 않는다. 업로드한 사진에 고른 색의 "색조"만
 *  캔버스로 살짝 입혀서(실제 질감·그림자 합성이 아님) 비포/애프터가 완전히
 *  같은 사진으로 보이지 않게만 한다 — 이걸 진짜 결과로 오해하면 안 되므로
 *  화면에 "데모용 미리보기" 라벨을 항상 같이 띄운다.
 *
 *  실제로 사진처럼 합성하려면: 이 코드베이스엔 이미 backend/app/services/
 *  rendering.py의 recolor_surface()가 있다 — Stable Diffusion/ControlNet이
 *  아니라 LAB 색공간에서 명암(L)은 보존하고 색(a/b)만 바꾸는 결정적 방식인데,
 *  이미 사장님 요청으로 diffusion 인페인팅을 시도했다가 "색이 반영 안 된다"는
 *  문제를 겪고 이 방식으로 바꾼 전력이 있다(같은 파일 주석 참고). 이 Mock을
 *  진짜로 만들려면 그 함수를 호출할 새 API(사진+마스크를 받아 recolor_surface
 *  실행)가 필요한데, "마스크(어디가 샷시인지)"를 즉석에서 올린 임의의 사진에서
 *  자동으로 얻는 부분은 이 기능엔 아직 없다(기존 메인 플로우는 안내된 촬영
 *  구도로 이 문제를 피해간다) — 백엔드 연동을 원하면 이 부분을 먼저 설계해야
 *  한다. */
async function mockGenerateVirtualConstruction(photoUrl: string, pick: VirtualConstructionPick): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 2600));

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
    img.src = photoUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return photoUrl;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = pick.approxHex;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : photoUrl);
    }, "image/jpeg", 0.9);
  });
}

export default function VirtualConstructionView({ pick, partLabel, quoteTotal }: VirtualConstructionViewProps) {
  const business = useBusinessInfo();
  const [stage, setStage] = useState<Stage>("upload");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [msgIndex, setMsgIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messages = processingMessages(partLabel, pick);

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

  async function startProcessing() {
    if (!photoUrl) return;
    setStage("processing");
    setError(null);
    setMsgIndex(0);
    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % messages.length);
    }, 1300);
    try {
      const after = await mockGenerateVirtualConstruction(photoUrl, pick);
      setResultUrl(after);
      setStage("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "가상 시공에 실패했습니다.");
      setStage("upload");
    } finally {
      clearInterval(interval);
    }
  }

  function reset() {
    if (resultUrl && resultUrl !== photoUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setStage("upload");
  }

  return (
    <div className="rounded-2xl bg-[#f8f9fa] p-4">
      <p className="text-[12.5px] font-bold text-indigo-600">AI 가상 시공 (실제 사진 합성)</p>

      {/* 1단계: 현장 사진 업로드 */}
      {stage === "upload" && (
        <div className="mt-3">
          <p className="text-[13px] leading-relaxed text-[#5b6573]">
            시공할 부위({partLabel})의 실제 사진을 올려주세요. 선택한{" "}
            <b>
              {pick.brand} {pick.code}({pick.name})
            </b>
            을 그 사진 위에 가상으로 입혀 보여드립니다.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFile}
            className="hidden"
          />

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
              onClick={startProcessing}
              disabled={!photoUrl}
              className="h-12 flex-1 rounded-2xl bg-indigo-600 text-[15px] font-bold text-white disabled:bg-[#d1d6db]"
            >
              AI 가상 시공 시작하기
            </button>
          </div>
        </div>
      )}

      {/* 2단계: AI 시공 중 로딩 */}
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

      {/* 3단계: 비포/애프터 슬라이더 + 자재/견적/실측신청 */}
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
            데모용 색상 미리보기입니다 — 질감·그림자까지 반영한 정밀 합성은 아직 연동 전입니다.
            가운데 바를 좌우로 끌어 비교해 보세요.
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-4 py-3">
            <span className="h-6 w-6 shrink-0 rounded-full border border-black/5" style={{ backgroundColor: pick.approxHex }} />
            <span className="text-[13.5px] font-bold text-[#191f28]">
              적용 품번 — {pick.brand} {pick.code} ({pick.name})
            </span>
          </div>

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
