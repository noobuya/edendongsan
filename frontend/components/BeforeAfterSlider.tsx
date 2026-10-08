"use client";

import { useEffect, useState } from "react";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import { fetchAssetObjectUrl } from "@/lib/api";

interface Props {
  /** 시공 전 사진. "/static/..." 같은 상대 경로와 절대 URL 둘 다 받는다. */
  beforeSrc: string;
  /** 시공 후(AI 합성) 사진. */
  afterSrc: string;
  className?: string;
}

/** 시공 전/후 사진을 좌우로 끌어보며 비교하는 슬라이더.
 *
 *  react-compare-slider의 이미지 하위 컴포넌트는 그냥 <img src>라서 커스텀 헤더를
 *  못 싣는다(AssetImage 주석 참고 — ngrok 경고 페이지를 이미지로 잘못 읽는 문제).
 *  그래서 여기서 fetchAssetObjectUrl로 미리 blob URL을 받아온 뒤 그 blob URL만
 *  슬라이더에 넘긴다. */
export default function BeforeAfterSlider({ beforeSrc, afterSrc, className = "" }: Props) {
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let createdBefore: string | null = null;
    let createdAfter: string | null = null;
    setBeforeUrl(null);
    setAfterUrl(null);
    setFailed(false);

    Promise.all([fetchAssetObjectUrl(beforeSrc), fetchAssetObjectUrl(afterSrc)])
      .then(([b, a]) => {
        if (!active) {
          URL.revokeObjectURL(b);
          URL.revokeObjectURL(a);
          return;
        }
        createdBefore = b;
        createdAfter = a;
        setBeforeUrl(b);
        setAfterUrl(a);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (createdBefore) URL.revokeObjectURL(createdBefore);
      if (createdAfter) URL.revokeObjectURL(createdAfter);
    };
  }, [beforeSrc, afterSrc]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 ${className}`}>
        <span className="text-[12px] text-slate-400">사진을 불러오지 못했습니다</span>
      </div>
    );
  }

  if (!beforeUrl || !afterUrl) {
    return <div className={`animate-pulse bg-slate-100 ${className}`} />;
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <ReactCompareSlider
        itemOne={<ReactCompareSliderImage src={beforeUrl} alt="시공 전" />}
        itemTwo={<ReactCompareSliderImage src={afterUrl} alt="시공 후" />}
        style={{ width: "100%", height: "100%" }}
      />
      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white">
        시공 전
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white">
        시공 후
      </span>
    </div>
  );
}
