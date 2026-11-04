"use client";

import { useEffect, useState } from "react";
import AssetImage from "@/components/AssetImage";
import { getBrandAssets, type BrandAssets } from "@/lib/api";
import { BUSINESS_NAME } from "@/lib/businessInfo";

/** 블로그 메인 맨 위에서 로고·명함을 크게 보여준다. 사장님이 /admin/brand에
 *  아무것도 올리지 않았으면 빈 칸을 남기지 않고 아예 그리지 않는다. */
export default function BrandShowcase() {
  const [assets, setAssets] = useState<BrandAssets | null>(null);

  useEffect(() => {
    let active = true;
    getBrandAssets()
      .then((a) => active && setAssets(a))
      .catch(() => active && setAssets({ logo: null, card: null, hero: null }));
    return () => {
      active = false;
    };
  }, []);

  if (!assets || (!assets.logo && !assets.card)) return null;

  return (
    <div className="mb-6 flex items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      {/* 로고가 정사각형이란 보장이 없어(가로로 긴 명함형 로고도 올라온다) 너비를
          칸에 가두지 않는다 — 높이만 정하고 object-contain이 원본 비율대로 너비를
          정하게 두면, 가로로 긴 로고를 억지로 짜부라뜨려 거의 안 보이게 되는 일이
          없다. */}
      {assets.logo && (
        <AssetImage
          src={assets.logo}
          alt={`${BUSINESS_NAME} 로고`}
          className="h-16 w-auto max-w-[200px] shrink-0 rounded-xl object-contain"
        />
      )}
      {assets.card && (
        <AssetImage
          src={assets.card}
          alt={`${BUSINESS_NAME} 명함`}
          className="h-16 w-auto max-w-[280px] flex-1 rounded-lg object-contain"
        />
      )}
    </div>
  );
}
