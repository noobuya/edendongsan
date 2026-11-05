"use client";

import { useEffect, useState } from "react";
import { getBusinessInfo } from "./api";

// [왜 — 2026-11-05 사장님 요청 "상호명·전화번호를 설정에서 직접 바꿀 수 있게"]
// 예전엔 이 파일이 고정 상수였다 — 바꾸려면 코드를 고치고 다시 배포해야 했다.
// 이제 실제 값은 서버(app/business_info.py)에서 온다. 아래 DEFAULT_*는 서버
// 응답이 오기 전 또는 서버에 못 닿을 때만 쓰는 안전한 폴백이라, 서버 기본값과
// 반드시 같게 맞춘다.
export const DEFAULT_BUSINESS_NAME = "대한인테리어필름";
export const DEFAULT_BUSINESS_PHONE = "010-7664-8007";
export const DEFAULT_BUSINESS_SERVICE_AREA = "대구 전지역 및 경북 지역 출장 가능";

export interface BusinessInfoValues {
  name: string;
  phone: string;
  serviceArea: string;
  phoneTelHref: string;
  /** 도장에 두 줄로 나눠 찍을 상호(BusinessStamp.tsx). 정식 설정값이 아니라
   *  상호명 길이에 맞춰 그 자리에서 둘로 나눈다 — 상호명을 바꿔도 도장이
   *  따라가지만, 자연스러운 단어 경계로 나뉘진 않는다(예: "대한인테리어필름"은
   *  원래 "대한인테리어"/"필름"으로 손으로 나눴던 것과 다를 수 있다). */
  stampLines: [string, string];
}

function splitForStamp(name: string): [string, string] {
  if (name.length <= 2) return [name, ""];
  const mid = Math.ceil(name.length / 2);
  return [name.slice(0, mid), name.slice(mid)];
}

function toValues(info: { business_name: string; phone: string; service_area: string }): BusinessInfoValues {
  return {
    name: info.business_name,
    phone: info.phone,
    serviceArea: info.service_area,
    phoneTelHref: `tel:${info.phone.replace(/-/g, "")}`,
    stampLines: splitForStamp(info.business_name),
  };
}

const DEFAULT_VALUES: BusinessInfoValues = toValues({
  business_name: DEFAULT_BUSINESS_NAME,
  phone: DEFAULT_BUSINESS_PHONE,
  service_area: DEFAULT_BUSINESS_SERVICE_AREA,
});

// 한 화면에 이 훅을 쓰는 컴포넌트가 여럿이라(상단 배너·전화 배너·영수증·도장 등)
// 매번 따로 불러오면 요청이 중복된다 — 세션 안에서 한 번만 불러오고 결과를
// 공유한다. 사장님이 설정에서 값을 바꾼 뒤에는 새로고침하면 반영된다(실시간
// 구독까지는 필요 없는 정보라 과한 설계를 피했다).
let cache: Promise<BusinessInfoValues> | null = null;
function loadOnce(): Promise<BusinessInfoValues> {
  if (!cache) {
    cache = getBusinessInfo()
      .then(toValues)
      .catch(() => DEFAULT_VALUES);
  }
  return cache;
}

/** 설정(/admin/brand)에서 바꾼 상호명·전화번호·출장 지역을 불러온다. 응답이 오기
 *  전까지는 기본값을 보여줘 깜빡임 없이 시작한다. */
export function useBusinessInfo(): BusinessInfoValues {
  const [values, setValues] = useState<BusinessInfoValues>(DEFAULT_VALUES);
  useEffect(() => {
    let active = true;
    loadOnce().then((v) => {
      if (active) setValues(v);
    });
    return () => {
      active = false;
    };
  }, []);
  return values;
}
