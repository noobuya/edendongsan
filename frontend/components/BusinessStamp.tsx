"use client";

import { useState } from "react";
import { BUSINESS_NAME, BUSINESS_STAMP_LINES } from "@/lib/businessInfo";

/** 실물 도장 스캔본을 넣는 자리. 파일이 있으면 그 이미지를 쓰고, 없으면 상호명으로 만든 도장을 쓴다.
 *  (스캔본은 배경이 투명한 PNG를 권장한다.) */
export const STAMP_IMAGE_SRC = "/images/stamp.png";

/** 견적서 푸터에 찍히는 상호 도장. 이미지 캡처(html2canvas)에 들어가도록 곡선 문자 없이
 *  일반 HTML·CSS로만 그린다. 원가 정보가 없는 공개용 요소라 견적서 이미지에 그대로 들어간다. */
export default function BusinessStamp({ className = "" }: { className?: string }) {
  const [imageMissing, setImageMissing] = useState(false);

  if (!imageMissing) {
    return (
      <img
        src={STAMP_IMAGE_SRC}
        alt={`${BUSINESS_NAME} 도장`}
        onError={() => setImageMissing(true)}
        className={`h-[84px] w-[84px] object-contain ${className}`}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={`${BUSINESS_NAME} 도장`}
      className={`relative flex h-[84px] w-[84px] shrink-0 -rotate-[12deg] items-center justify-center rounded-full border-[3px] border-[#d8362f] text-[#d8362f] ${className}`}
      style={{ opacity: 0.88 }}
    >
      <div className="absolute inset-[4px] rounded-full border-[1.5px] border-[#d8362f]" />
      <div className="text-center font-extrabold leading-[1.2]">
        <p className="text-[11px] tracking-tight">{BUSINESS_STAMP_LINES[0]}</p>
        <p className="text-[14px] tracking-tight">{BUSINESS_STAMP_LINES[1]}</p>
        <p className="mt-0.5 text-[11px] font-bold">(인)</p>
      </div>
    </div>
  );
}
