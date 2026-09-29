"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, RotateCcw } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import { BRAND_HERO_ALT, useBrandImageSrc } from "@/components/BrandHero";
import CameraSheet from "@/components/CameraSheet";
import { BUSINESS_SERVICE_AREA } from "@/lib/businessInfo";

interface Props {
  photoUrl: string | null;
  onCapture: (file: File) => void;
  onRetake: () => void;
  /** 결과 단계에서는 배경만 깔고 촬영 UI를 감춘다. */
  showCapture?: boolean;
  /** 카메라 시트 열림 상태는 페이지가 들고 있다 — 뒤로 가기가 "떠 있는 것"부터
   *  닫아야 하는데, 이 컴포넌트 안에만 있으면 페이지가 알 수 없다. */
  cameraOpen?: boolean;
  onCameraOpenChange?: (open: boolean) => void;
}

/** 화면 전체를 차지하는 배경 무대(캔버스).
 *
 *  앱을 좌우로 쪼개지 않고, 배경 자체가 뷰파인더이자 사진 뷰어다. 조작용 유리 패널은
 *  이 위에 떠 있고, 그 뒤로 배경이 비친다. 촬영 UI를 패널 안이 아니라 무대 한가운데
 *  두는 이유도 같다 — 사진을 찍는 순간만큼은 카메라 앱처럼 보여야 한다. */
export default function CanvasStage({
  photoUrl,
  onCapture,
  onRetake,
  showCapture = true,
  cameraOpen,
  onCameraOpenChange,
}: Props) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const heroSrc = useBrandImageSrc();
  // 촬영 단계에서 아직 사진이 없을 때만 대표 시공 사진(또는 같은 결의 어두운 면)을 배경으로 쓴다.
  const heroStage = showCapture && !photoUrl;
  // 페이지가 상태를 들고 있으면 그걸 쓰고, 아니면 예전처럼 스스로 관리한다.
  const [localCameraOpen, setLocalCameraOpen] = useState(false);
  const isCameraOpen = cameraOpen ?? localCameraOpen;
  const setCameraOpen = onCameraOpenChange ?? setLocalCameraOpen;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onCapture(file);
  }

  return (
    <>
      <div className="absolute inset-0 -z-10">
        {photoUrl ? (
          <>
            {/* 촬영 직후의 blob: 주소는 그냥 <img>로 되지만, 서버(ngrok 등)에서
                받아오는 사진은 헤더가 필요해 평범한 <img src>로는 깨진다.
                주소 종류에 따라 갈라 쓴다 (AssetImage 주석 참고). */}
            {photoUrl.startsWith("blob:") || photoUrl.startsWith("data:") ? (
              <img src={photoUrl} alt="현장 사진" className="h-full w-full object-cover" />
            ) : (
              <AssetImage src={photoUrl} alt="현장 사진" className="h-full w-full object-cover" />
            )}
            {/* 사진 위에 얹히는 유리 패널의 글씨가 묻히지 않도록 아주 옅은 비네팅을 깐다. */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900/10 via-transparent to-slate-900/20" />
          </>
        ) : heroStage ? (
          <div className="relative h-full w-full overflow-hidden bg-[#1c222b]">
            {heroSrc && (
              <img src={heroSrc} alt={BRAND_HERO_ALT} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {/* 위(앱 바)와 아래(조작 패널·버튼) 글씨가 사진 위에서도 읽히도록 어두운 그라데이션을 깐다. */}
            <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black/65" />
          </div>
        ) : (
          <div className="canvas-stage h-full w-full" />
        )}
      </div>

      {/* 촬영 UI는 패널이 덮지 않는 무대 영역의 한가운데에 놓는다.
          (세로: 패널이 아래 절반을 쓰므로 위쪽 / 가로: 패널이 오른쪽이므로 왼쪽) */}
      {showCapture && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[62%] top-36 z-10 flex items-center justify-center px-6 foldLandscape:bottom-0 foldLandscape:right-[452px] foldLandscape:top-24">
          {photoUrl ? (
            <button
              type="button"
              onClick={onRetake}
              className="glass-pill pointer-events-auto flex items-center gap-2 px-5 py-3 text-[13px] font-semibold text-slate-700 transition-transform active:scale-95"
            >
              <RotateCcw className="h-4 w-4" />
              다시 촬영
            </button>
          ) : (
            <div className="pointer-events-auto flex flex-col items-center gap-5 text-center foldLandscape:gap-7">
              <div className="space-y-1.5">
                <p className="text-[21px] font-extrabold leading-[1.3] tracking-[-0.02em] text-white break-keep foldLandscape:text-[28px]">
                  {BRAND_HERO_ALT}
                </p>
                <p className="text-[13px] text-white/85 break-keep">{BUSINESS_SERVICE_AREA}</p>
              </div>

              {/* 유리 알약 버튼 — 반투명 흰 면 + 블러 + 얇은 테두리. 사진 위에서도 또렷하다.
                  촬영(주 동작)이 넓은 알약, 앨범(보조 동작)이 같은 높이의 정사각 아이콘
                  버튼으로 옆에 붙어 크기·색·아이콘의 무게가 자연스럽게 갈린다. */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex h-14 items-center gap-2.5 rounded-full border border-white/40 bg-white/20 px-7 text-[16px] font-bold text-white shadow-[0_8px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-200 hover:bg-white/30 active:scale-95"
                >
                  <Camera className="h-5 w-5" strokeWidth={1.75} />
                  시공 공간 촬영하기
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  aria-label="앨범에서 선택"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white shadow-[0_8px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-200 hover:bg-white/30 active:scale-95"
                >
                  <ImagePlus className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </div>

              <p className="text-[13px] text-white/80 break-keep">벽·천장 전체가 화면에 들어오도록 담아주세요</p>
            </div>
          )}
        </div>
      )}

      <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />

      <CameraSheet
        open={isCameraOpen}
        onCapture={onCapture}
        onClose={() => setCameraOpen(false)}
        onPickFile={() => galleryInputRef.current?.click()}
      />
    </>
  );
}
