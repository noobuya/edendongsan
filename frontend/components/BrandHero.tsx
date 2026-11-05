"use client";

import { useEffect, useState } from "react";
import AssetImage from "@/components/AssetImage";
import { getBrandAssets } from "@/lib/api";
import { useBusinessInfo } from "@/lib/businessInfo";

/** 대표 시공 사진이 놓이는 자리. 사장님이 /admin/brand에서 올린 사진이 최우선이고,
 *  아직 한 번도 안 올렸으면 코드에 미리 넣어둔 public/images/eden_main.jpg로
 *  대체된다(권장: 가로형 1600×900 이상). */
export const BRAND_HERO_SRC = "/images/eden_main.jpg";
export const BRAND_HERO_ALT = "대한인테리어 필름 프리미엄 시공";
// public/ 바로 아래(/eden_main.jpg)에 넣어도 찾아 쓴다.
const BRAND_HERO_CANDIDATES = [BRAND_HERO_SRC, "/eden_main.jpg"];

/** 코드에 미리 넣어둔 기본 사진 후보 중 실제로 있는 첫 경로를 돌려준다(없으면 null).
 *  사진이 없을 때 깨진 이미지가 화면에 잠깐도 뜨지 않게 하려는 것이다. */
function probeStaticFallback(onFound: (src: string) => void, isCancelled: () => boolean) {
  (function tryNext(i: number) {
    if (i >= BRAND_HERO_CANDIDATES.length) return;
    const probe = new window.Image();
    probe.onload = () => {
      if (!isCancelled()) onFound(BRAND_HERO_CANDIDATES[i]);
    };
    probe.onerror = () => tryNext(i + 1);
    probe.src = BRAND_HERO_CANDIDATES[i];
  })(0);
}

/** 대표 사진 주소를 돌려준다 — 사장님이 /admin/brand에서 올린 사진을 최우선으로
 *  쓰고, 없거나(또는 서버에 못 닿으면) 코드에 미리 넣어둔 기본 사진으로 조용히
 *  대체된다. 둘 다 없으면 null(사진 없이 글자만 보이는 화면). */
export function useBrandImageSrc(): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBrandAssets()
      .then((assets) => {
        if (cancelled) return;
        if (assets.hero) {
          setSrc(assets.hero);
          return;
        }
        probeStaticFallback(setSrc, () => cancelled);
      })
      .catch(() => {
        if (!cancelled) probeStaticFallback(setSrc, () => cancelled);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return src;
}

/** 사장님이 /admin/brand에서 올린 로고 주소. 없으면 null. */
export function useBrandLogoSrc(): string | null {
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getBrandAssets()
      .then((a) => active && setLogo(a.logo))
      .catch(() => {
        /* 로고가 아직 없거나 서버에 못 닿아도 글자 상호로 조용히 대체된다. */
      });
    return () => {
      active = false;
    };
  }, []);
  return logo;
}

/** 대표 사진 위 글씨 옆에 붙는 로고 배지. 로고를 올려두지 않았으면 아무것도
 *  그리지 않는다(빈 자리를 남기지 않고 글자만으로도 완성된 화면이어야 한다).
 *
 *  [정사각형으로 가두지 않는다]
 *  사장님이 올리는 "로고"가 꼭 정사각형이란 보장이 없다(가로로 긴 명함형 로고를
 *  올린 적이 있었다) — 가로세로를 고정 칸에 맞추면 object-contain이 옆으로 긴
 *  그림을 실 가닥처럼 짜부라뜨려서, 올렸는데도 거의 안 보이는 것처럼 느껴진다.
 *  높이만 정하고 너비는 원본 비율대로 자연스럽게 늘어나게 둔다. */
export function BrandLogoMark({ className = "" }: { className?: string }) {
  const logo = useBrandLogoSrc();
  if (!logo) return null;
  return (
    <span
      className={`inline-flex h-10 max-w-[200px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/90 px-1.5 shadow-sm ${className}`}
    >
      <AssetImage src={logo} alt="" className="h-full w-auto max-w-full object-contain" />
    </span>
  );
}

/** 첫 화면·견적 화면 위쪽의 대표 사진 카드.
 *
 *  [사진이 아직 없을 때]
 *  깨진 이미지 아이콘이 뜨면 고객 앞에서 가장 먼저 보이는 곳이 망가져 보인다. 파일이 없으면
 *  같은 카드 모양의 차분한 어두운 면 위에 같은 글이 올라가, 사진을 넣기 전에도 완성된 화면이다.
 *  글씨는 사진 위든 어두운 면 위든 읽히도록 항상 아래에서 올라오는 어두운 그라데이션을 깐다. */
export default function BrandHero({ aspect = "aspect-[16/9]", className = "" }: { aspect?: string; className?: string }) {
  const src = useBrandImageSrc();
  const { serviceArea } = useBusinessInfo();

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
      <figcaption className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-5">
        <BrandLogoMark />
        <div>
          <p className="text-[19px] font-extrabold leading-[1.3] tracking-[-0.02em] text-white break-keep [text-wrap:balance]">
            {BRAND_HERO_ALT}
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-white/85 break-keep">{serviceArea}</p>
        </div>
      </figcaption>
    </figure>
  );
}
