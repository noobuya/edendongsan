"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CloudRain, ThermometerSun } from "lucide-react";
import { getWeatherAdvisory, type WeatherAdvisory } from "@/lib/api";

const LEVEL_STYLE_LIGHT: Record<WeatherAdvisory["level"], string> = {
  warning: "bg-rose-50 text-rose-700",
  caution: "bg-amber-50 text-amber-700",
  ok: "bg-emerald-50 text-emerald-700",
};
// /cutting처럼 어두운 배경 화면에서 쓰는 톤 — 기존 cutting/page.tsx의 경고 배지와
// 같은 관례(반투명 배경 + 밝은 글자, bg-{색}-500/15 text-{색}-300).
const LEVEL_STYLE_DARK: Record<WeatherAdvisory["level"], string> = {
  warning: "bg-rose-500/15 text-rose-300",
  caution: "bg-amber-500/15 text-amber-300",
  ok: "bg-emerald-500/15 text-emerald-300",
};
const LEVEL_ICON: Record<WeatherAdvisory["level"], typeof AlertTriangle> = {
  warning: CloudRain,
  caution: ThermometerSun,
  ok: ThermometerSun,
};

/** 현장 지역 날씨로 필름 들뜸·기포 하자를 미리 경고하는 배너 — 기공·조공 양쪽
 *  화면 상단에 공통으로 띄운다(/recruiting, /cutting). 날씨 조회가 실패해도
 *  (예: 외부 서비스 장애) 조용히 숨긴다 — 참고용 조언이지 필수 기능이 아니라서
 *  화면을 막거나 에러를 띄울 정도는 아니다. */
export default function WeatherAdvisoryBanner({
  location,
  dark = false,
  className = "",
}: {
  location?: string;
  /** /cutting처럼 어두운 배경 화면에서는 true — 밝은 배경용 팔레트 대신 반투명+밝은
   *  글자 팔레트를 쓴다. */
  dark?: boolean;
  className?: string;
}) {
  const [advisory, setAdvisory] = useState<WeatherAdvisory | null>(null);

  useEffect(() => {
    let active = true;
    getWeatherAdvisory(location)
      .then((data) => {
        if (active) setAdvisory(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location]);

  if (!advisory || !advisory.available || advisory.level === "ok") return null;

  const wrap = (dark ? LEVEL_STYLE_DARK : LEVEL_STYLE_LIGHT)[advisory.level];
  const Icon = LEVEL_ICON[advisory.level];
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3.5 py-3 text-[12.5px] font-semibold leading-relaxed ${wrap} ${className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{advisory.message}</span>
    </div>
  );
}
