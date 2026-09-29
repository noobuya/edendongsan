"use client";

import { useEffect, useState } from "react";
import { BUSINESS_SERVICE_AREA } from "@/lib/businessInfo";

/** 대표 시공 사진이 놓이는 자리. 실제 사진은 public/images/eden_main.jpg 로 넣으면 된다.
 *  (권장: 가로형 1600×900 이상. 파일 이름만 같으면 코드는 건드리지 않아도 된다.) */
export const BRAND_HERO_SRC = "/images/eden_main.jpg";
export const BRAND_HERO_ALT = "에덴동산 인테리어 필름 프리미엄 시공";
// public/ 바로 아래(/eden_main.jpg)에 넣어도 찾아 쓴다.
const BRAND_HERO_CANDIDATES = [BRAND_HERO_SRC, "/eden_main.jpg"];

/** 대표 사진이 실제로 있는지 미리 불러 보고, 있는 첫 경로를 돌려준다(없으면 null).
 *  사진이 없을 때 깨진 이미지가 화면에 잠깐도 뜨지 않게 하려는 것이다. */
export function useBrandImageSrc(): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (function tryNext(i: number) {
      if (i >= BRAND_HERO_CANDIDATES.length) return;
      const probe = new window.Image();
      probe.onload = () => {
        if (!cancelled) setSrc(BRAND_HERO_CANDIDATES[i]);
      };
      probe.onerror = () => tryNext(i + 1);
      probe.src = BRAND_HERO_CANDIDATES[i];
    })(0);
    return () => {
      cancelled = true;
    };
  }, []);
  return src;
}

/** 첫 화면·견적 화면 위쪽의 대표 사진 카드.
 *
 *  [사진이 아직 없을 때]
 *  깨진 이미지 아이콘이 뜨면 고객 앞에서 가장 먼저 보이는 곳이 망가져 보인다. 파일이 없으면
 *  같은 카드 모양의 차분한 어두운 면 위에 같은 글이 올라가, 사진을 넣기 전에도 완성된 화면이다.
 *  글씨는 사진 위든 어두운 면 위든 읽히도록 항상 아래에서 올라오는 어두운 그라데이션을 깐다. */
export default function BrandHero({ aspect = "aspect-[16/9]", className = "" }: { aspect?: string; className?: string }) {
  const src = useBrandImageSrc();

  return (
    <figure
      className={`relative isolate overflow-hidden rounded-[24px] bg-[#232a35] shadow-[0_1px_2px_rgba(25,31,40,0.06),0_12px_28px_-14px_rgba(25,31,40,0.35)] ${aspect} ${className}`}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- 정적 export(APK)에서도 같은 경로로 쓰려고 <img>를 쓴다
        <img src={src} alt={BRAND_HERO_ALT} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/5"
      />
      <figcaption className="absolute inset-x-0 bottom-0 p-5">
        <p className="text-[19px] font-extrabold leading-[1.3] tracking-[-0.02em] text-white break-keep [text-wrap:balance]">
          {BRAND_HERO_ALT}
        </p>
        <p className="mt-1.5 text-[13px] leading-snug text-white/85 break-keep">{BUSINESS_SERVICE_AREA}</p>
      </figcaption>
    </figure>
  );
}
