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
  /** 블로그처럼 크게 보여 줄 때 BEFORE/AFTER 라벨도 크게. */
  bigLabels?: boolean;
}

/** 시공 전/후 사진을 좌우로 끌어보며 비교하는 슬라이더.
 *
 *  react-compare-slider의 이미지 하위 컴포넌트는 그냥 <img src>라서 커스텀 헤더를
 *  못 싣는다(AssetImage 주석 참고 — ngrok 경고 페이지를 이미지로 잘못 읽는 문제).
 *  그래서 여기서 fetchAssetObjectUrl로 미리 blob URL을 받아온 뒤 그 blob URL만
 *  슬라이더에 넘긴다. */
export default function BeforeAfterSlider({ beforeSrc, afterSrc, className = "", bigLabels = false }: Props) {
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // bigLabels(블로그)일 때는 사진을 자르지 않고 원래 비율 그대로 보여 준다 — 시공 후
  // 사진의 가로:세로 비율로 상자를 잡는다("시공 전후 글자가 잘렸다", 2026-11-03).
  const [ratio, setRatio] = useState<number | null>(null);

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
        const probe = new Image();
        probe.onload = () => {
          if (active && probe.naturalWidth > 0) setRatio(probe.naturalWidth / probe.naturalHeight);
        };
        probe.src = a;
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

  const natural = bigLabels && ratio !== null;
  const fit = natural ? { objectFit: "contain" as const, backgroundColor: "#0f172a" } : undefined;
  return (
    <div
      className={`relative overflow-hidden ${natural ? "bg-slate-900" : ""} ${className}`}
      style={natural ? { aspectRatio: String(ratio) } : undefined}
    >
      <ReactCompareSlider
        itemOne={<ReactCompareSliderImage src={beforeUrl} alt="시공 전" style={fit} />}
        itemTwo={<ReactCompareSliderImage src={afterUrl} alt="시공 후" style={fit} />}
        style={{ width: "100%", height: "100%" }}
      />
      {bigLabels ? (
        <>
          <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-1.5 text-lg font-black tracking-wide text-white">
            BEFORE
          </span>
          <span className="pointer-events-none absolute right-3 top-3 rounded-lg bg-amber-400 px-3 py-1.5 text-lg font-black tracking-wide text-slate-900">
            AFTER
          </span>
        </>
      ) : (
        <>
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white">
            시공 전
          </span>
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white">
            시공 후
          </span>
        </>
      )}
    </div>
  );
}
