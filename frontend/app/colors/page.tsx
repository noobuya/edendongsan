"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, X } from "lucide-react";
import { ALL_PATTERN_SWATCHES, TONE_LABELS } from "@/lib/patternSwatches";
import { useSwipeNavigate } from "@/lib/useSwipeNavigate";
import { getEstimatorItems, getSwatchPhotos, getSwatchScans, swatchScanPhotoUrl, type EstimatorItem, type SwatchScanEntry } from "@/lib/api";
import AssetImage from "@/components/AssetImage";
import VirtualConstructionView from "@/components/colors/VirtualConstructionView";
import type { PatternSwatch } from "@/types";

/** 숫자가 0에서 목표값까지 스르륵 올라가는 효과 — 오늘의집·토스 앱 스타일.
 *  target이 바뀔 때마다(=새로 견적을 보여줄 때마다) 처음부터 다시 올라간다. */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — 처음엔 빠르게, 끝에서 부드럽게 멈춘다.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

/** 현장에서 고객이 "따뜻한 느낌 필름지 뭐 있어요?"처럼 색상을 물을 때, 그 자리에서
 *  바로 걸러 보여주는 색상표. AI 렌더링(사진 위에 입히기)은 시간이 걸리고 비용이
 *  드는데다 사진이 있어야만 되는데, 이 화면은 카탈로그에 이미 있는 실제 색상·
 *  제품코드(현대보닥)를 즉시 톤별로 걸러서 보여주기만 하므로 사진 없이도, 기다릴
 *  필요 없이 바로 보여줄 수 있다 — "느낌"을 말로 설명하는 것보다 실제 색을 눈으로
 *  보고 고르는 게 훨씬 빠르다.
 *
 *  [왜 KCC는 아직 없는가] 보닥(BODAQ)은 공식 카탈로그의 실제 제품코드를 그대로
 *  옮겨 적어 발주에 바로 쓸 수 있다(catalog.py 참고). KCC도 같은 수준으로
 *  정확해야 발주 사고가 안 나는데, 아직 실제 제품코드·컬러명을 확인하지 못해
 *  임의로 지어 넣지 않았다 — 사장님이 실제로 쓰는 KCC 제품 라인업(코드·색상명)을
 *  알려주시면 그대로 추가한다. */
const TONE_FILTERS: { key: PatternSwatch["tone"] | "all"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "warm", label: "웜톤" },
  { key: "cool", label: "쿨톤" },
  { key: "neutral", label: "뉴트럴" },
  { key: "wood", label: "우드톤" },
];

// [왜 — 2026-11-07 "고객이 따뜻한 색을 원한다고 입력하면... 현대보닥 기준으로
// 말해줘"] 고객 말을 그대로 받아 톤을 짐작한다. 느낌을 말로 설명하는 것보다
// 실제 발주 가능한 보닥 품번으로 바로 짚어 주는 게 더 믿음직하다 — AI 호출
// 없이 키워드만 보고 즉시 판단하므로 기다릴 필요가 없다(현장에서 "바로"
// 보여줘야 하는 상황에 더 맞는다).
const TONE_KEYWORDS: { tone: PatternSwatch["tone"]; words: string[] }[] = [
  { tone: "warm", words: ["따뜻", "웜", "포근", "아늑", "베이지", "크림", "노란"] },
  { tone: "cool", words: ["차가운", "차갑", "쿨", "시원", "모던", "블루", "네이비", "그레이"] },
  { tone: "wood", words: ["나무", "우드", "원목", "내추럴", "오크", "월넛"] },
  { tone: "neutral", words: ["무난", "깔끔", "심플", "화이트", "기본", "편안"] },
];

function guessTone(query: string): PatternSwatch["tone"] | null {
  for (const { tone, words } of TONE_KEYWORDS) {
    if (words.some((w) => query.includes(w))) return tone;
  }
  return null;
}

// [왜 — 2026-11-08 "바닥 색상·벽지 종류·분위기를 입력하면 오늘의집 트렌드
// 기준으로 보닥/KCC 품번을 추천해줘"] "오늘의집 실시간 1위"처럼 구체적인
// 순위·통계는 실시간으로 확인할 방법이 없어 쓰지 않는다 — 확인 안 된 수치를
// 확신 있게 말하면 고객에게 거짓을 파는 것이다. 대신 "요즘 가장 선호도가
// 높은 조합입니다"처럼 일반적으로 맞는 트렌드는 애매하게 돌리지 않고
// 확신 있는 전문가 톤으로 말한다(사장님 요청, 2026-11-08) — "순위" 같은
// 특정 수치만 피하고 "선호도·정석 조합" 표현은 자신 있게 쓴다. 품번은
// 검증된 보닥 카탈로그로만 추천한다. 밝기(luminance)로 "화이트우드"는
// 밝은 우드, "클래식"은 짙은 우드를 가려 고른다 — 아래 RECOMMEND_DB가
// 이미 분위기별로 정확한 품번을 담고 있어 이제 밝기순 정렬은 필요 없다.
interface MoodPreset {
  key: string;
  label: string;
  reason: (floor: string, wallpaper: string) => string;
}
const MOOD_PRESETS: MoodPreset[] = [
  {
    key: "whitewood",
    label: "화이트우드",
    reason: (floor, wallpaper) =>
      `화이트우드는 요즘 인테리어 현장에서 가장 선호도가 높은 정석 조합입니다. ${floor || "밝은"} 바닥과 ${wallpaper || "화이트 톤"} 벽지에 밝은 우드를 매칭하면 공간이 넓고 화사해 보이면서도 나무 질감으로 포인트가 살아납니다.`,
  },
  {
    key: "modern",
    label: "모던",
    reason: (floor, wallpaper) =>
      `쿨톤 그레이·네이비는 모던한 분위기를 낼 때 가장 강력하게 추천하는 매칭입니다. ${floor || "무난한"} 바닥, ${wallpaper || "그레이 계열"} 벽지와 맞물려 또렷하고 정돈된 공간을 완성합니다.`,
  },
  {
    key: "minimal",
    label: "미니멀",
    reason: (floor, wallpaper) =>
      `뉴트럴 화이트·그레이는 미니멀 인테리어에서 가장 안전하고 세련된 선택입니다. ${floor || "밝은"} 바닥, ${wallpaper || "화이트"} 벽지와 시선을 분산시키지 않고 깔끔하게 어우러집니다.`,
  },
  {
    key: "cozy",
    label: "웜 내추럴",
    reason: (floor, wallpaper) =>
      `베이지·에크루 계열은 아늑한 공간을 원할 때 가장 먼저 권하는 정석 조합입니다. ${floor || "베이지"} 바닥, ${wallpaper || "웜톤"} 벽지와 톤을 맞춰 편안한 느낌을 완성합니다.`,
  },
  {
    key: "classic",
    label: "클래식",
    reason: (floor, wallpaper) =>
      `짙은 월넛·에스프레소 톤은 하이엔드 인테리어에서 가장 강력하게 추천하는 매칭입니다. ${floor || "짙은"} 바닥, ${wallpaper || "무게감 있는"} 벽지와 어우러져 고급스럽고 중후한 느낌을 완성합니다.`,
  },
];

interface BrandPick {
  brand: string;
  code: string;
  name: string;
  /** 공식 hex를 공개하지 않는 브랜드라 설명(색상명)을 보고 잡은 근사치 —
   *  카탈로그의 기존 보닥 색상들과 같은 원칙(화면 미리보기용일 뿐, 발주는
   *  브랜드·코드로 한다). */
  approxHex: string;
}
/** [왜 — 2026-11-08 사장님이 직접 제공한 현장 품번 DB] 브랜드 4곳(현대보닥·
 *  LX Z:IN·KCC·영림)의 베스트셀러 품번을 사장님이 현장 기준으로 알려준 그대로
 *  쓴다 — 더 이상 추측하지 않는다. MOOD_PRESETS의 5개 분위기와 정확히
 *  1:1로 맞물린다(화이트우드=밝은우드, 모던=무채색포인트, 미니멀=퓨어화이트,
 *  웜내추럴=웜화이트/크림, 클래식=짙은우드). [주의] 위 ALL_PATTERN_SWATCHES의
 *  기존 보닥 코드(예: 퓨어화이트=BLC05)와 아래 보닥 코드(퓨어화이트=S245)가
 *  서로 다르다 — 사장님 확인 대기 중. 두 데이터는 서로 다른 화면(스와치
 *  그리드 vs 이 맞춤 추천)에만 쓰여 지금은 충돌이 겉으로 드러나지 않지만,
 *  사장님이 어느 쪽이 맞는지 알려주시면 하나로 합친다. */
const RECOMMEND_DB: Record<string, BrandPick[]> = {
  minimal: [
    { brand: "현대보닥", code: "S245", name: "순백색 완전 무광", approxHex: "#FAFAF8" },
    { brand: "LX Z:IN", code: "ES130", name: "솔리드 무광 화이트", approxHex: "#F8F8F6" },
    { brand: "KCC", code: "PTW01", name: "무광 퓨어 화이트", approxHex: "#F7F7F5" },
    { brand: "영림", code: "PS071", name: "무광 퓨어 화이트", approxHex: "#F7F7F5" },
  ],
  cozy: [
    { brand: "현대보닥", code: "S115", name: "크림 화이트", approxHex: "#F2E8D5" },
    { brand: "현대보닥", code: "S212", name: "웜 베이지", approxHex: "#D9C2A0" },
    { brand: "LX Z:IN", code: "ES86", name: "크림 화이트", approxHex: "#F1E7D3" },
    { brand: "KCC", code: "PTW04", name: "웜 화이트", approxHex: "#F3E9D8" },
    { brand: "영림", code: "PS130", name: "크림 화이트", approxHex: "#F1E7D3" },
  ],
  whitewood: [
    { brand: "현대보닥", code: "W861", name: "잔잔한 내추럴 오크", approxHex: "#C9A878" },
    { brand: "LX Z:IN", code: "NW071", name: "내추럴 오크", approxHex: "#CBAA7A" },
    { brand: "KCC", code: "NW115", name: "내추럴 오크", approxHex: "#C8A877" },
    { brand: "영림", code: "PX449", name: "내추럴 오크", approxHex: "#CAA979" },
  ],
  classic: [
    { brand: "현대보닥", code: "W293", name: "다크 월넛", approxHex: "#4A3327" },
    { brand: "LX Z:IN", code: "NW043", name: "다크 월넛", approxHex: "#48311F" },
    { brand: "KCC", code: "NW062", name: "다크 우드", approxHex: "#432C1F" },
    { brand: "영림", code: "PX434", name: "월넛", approxHex: "#4A3325" },
  ],
  modern: [
    { brand: "현대보닥", code: "S208", name: "다크 그레이", approxHex: "#4B4F54" },
    { brand: "현대보닥", code: "NS804", name: "콘크리트 스톤", approxHex: "#8C8B86" },
    { brand: "LX Z:IN", code: "RS130", name: "다크 그레이", approxHex: "#4D5156" },
    { brand: "KCC", code: "PTS21", name: "다크 그레이", approxHex: "#4A4E53" },
    { brand: "영림", code: "PS044", name: "진그레이", approxHex: "#49494A" },
  ],
  // [왜 — 2026-11-08 사장님 제공] 포인트 컬러(딥 네이비·딥 그린) — 싱크대 하부장,
  // 현관문처럼 "무채색 대신 세련된 포인트"가 필요한 자리에서 쓴다.
  accent: [
    { brand: "현대보닥", code: "S149", name: "딥 네이비", approxHex: "#1F2A44" },
    { brand: "현대보닥", code: "S219", name: "딥 그린", approxHex: "#21382C" },
  ],
};

/** "현대보닥 S115와 KCC PTW04를 추천합니다" 형식의 한 줄 — 브랜드가 겹치면
 *  (예: "무채색 포인트"의 현대보닥 2종) 문장이 어색해지니, 브랜드당 하나만
 *  골라 최대 3곳까지 말해준다(세부 품번은 아래 카드 전부에서 볼 수 있다). */
function brandPickSentence(picks: BrandPick[]): string {
  const seen = new Set<string>();
  const unique = picks.filter((p) => (seen.has(p.brand) ? false : (seen.add(p.brand), true))).slice(0, 3);
  const parts = unique.map((p) => `${p.brand} ${p.code}`);
  if (parts.length === 1) return `${parts[0]}를 추천합니다.`;
  return `${parts.slice(0, -1).join(", ")}와 ${parts[parts.length - 1]}를 추천합니다.`;
}

/** RECOMMEND_DB 전체에서 품번 하나를 찾는다 — 자재별 추천이 분위기 묶음을
 *  넘나들며(예: 그란데 바닥은 cozy의 웜베이지와 minimal의 퓨어화이트를 같이
 *  쓴다) 같은 색 데이터를 또 베끼지 않게 한다. */
function findPick(code: string): BrandPick {
  for (const list of Object.values(RECOMMEND_DB)) {
    const found = list.find((p) => p.code === code);
    if (found) return found;
  }
  throw new Error(`알 수 없는 품번: ${code}`);
}

// [왜 — 2026-11-08 "고객이 '벽지는 디아망으로 할 거예요'라고 말하면 자재
// 특성부터 분석해서 필름을 추천해줘"] 요청한 3단계(① 자재 특성 ② 왜 이
// 필름인지 논리 ③ 품번)는 그대로 쓰지만, 1단계를 "오늘의집 데이터"로
// 포장하지 않는다 — 오늘의집이 실제로 뭘 1위로 꼽는지 확인할 방법이 없다.
// 대신 그 자재 자체의 실제로 알려진 특징(질감·광택·두께감)은 정직한
// 일반 지식으로 자신 있게 설명한다 — 이건 지어내는 게 아니라 디아망·
// 블랙마루 같은 자재들의 널리 알려진 특성이다. 모르는 자재는 모른다고
// 하고 분위기 칩으로 안내한다(지어낸 설명을 붙이지 않는다).
interface MaterialKnowledge {
  keywords: string[];
  kind: "벽지" | "바닥" | "문" | "공간" | "조명" | "포인트";
  trait: string; // 1단계: 자재 특성
  logic: string; // 2단계: 그래서 이런 필름이어야 하는 이유
  picks: BrandPick[]; // 3단계에서 보여줄 품번(칩)
  recommendLine: string; // 3단계 한 줄 — 자재마다 추천 방식이 달라(단일/양자택일/교차브랜드) 직접 쓴다.
}
const MATERIAL_KB: MaterialKnowledge[] = [
  {
    keywords: ["디아망"],
    kind: "벽지",
    trait:
      "디아망은 LX Z:IN의 대표 실크 벽지로, 깊은 음영의 엠보싱 질감과 차분한 무광 톤이 특징입니다. 과한 반사 없이 은은한 음영을 내는 자재라, 질감 벽지를 찾는 시공 현장에서 꾸준히 사랑받는 선택입니다.",
    logic:
      "질감이 깊고 음영이 있는 벽지에 광택이나 나뭇결이 두드러지는 필름을 더하면 서로 부딪혀 촌스러워 보입니다. 빛 반사가 적은 완전 무광 솔리드 필름을 매칭하는 쪽이 실패 없는 조합으로 꼽힙니다.",
    picks: RECOMMEND_DB.modern,
    recommendLine: brandPickSentence(RECOMMEND_DB.modern),
  },
  {
    keywords: ["블랙마루", "블랙 마루", "흑단마루", "블랙 계열", "블랙계열"],
    kind: "바닥",
    trait: "짙은 블랙 계열 마루는 공간에 무게감과 고급스러움을 주는 자재로, 호텔식·모던 인테리어를 원하는 분들이 자주 선택합니다.",
    logic:
      "바닥이 이미 어둡고 무게감 있으므로, 문·몰딩까지 같이 짙게 가면 공간이 답답해 보일 위험이 있습니다. 중간 톤의 무채색 필름으로 균형을 잡아주는 쪽이 실패 없는 정석으로 꼽힙니다.",
    picks: RECOMMEND_DB.modern,
    recommendLine: brandPickSentence(RECOMMEND_DB.modern),
  },
  {
    keywords: ["화이트마루", "화이트 마루", "오크마루", "오크 마루"],
    kind: "바닥",
    trait: "화이트·오크 계열의 밝은 마루는 공간을 넓고 화사하게 보이게 하며, 어떤 벽지·필름과도 무난하게 어울리는 베이스입니다.",
    logic: "밝은 바닥에는 같은 계열의 밝은 우드나 화이트 계열 필름을 매칭해야 톤이 끊기지 않고 공간이 넓어 보입니다.",
    picks: RECOMMEND_DB.whitewood,
    recommendLine: brandPickSentence(RECOMMEND_DB.whitewood),
  },
  {
    keywords: ["콘크리트", "노출콘크리트", "노출 콘크리트"],
    kind: "벽지",
    trait: "노출 콘크리트 질감은 차갑고 거친 느낌을 주는 자재로, 인더스트리얼·시크한 분위기를 낼 때 주로 선택합니다.",
    logic: "거친 질감의 벽에는 매끈한 광택 필름보다 같은 계열의 무채색 매트 필름이 톤을 해치지 않고 시크한 분위기를 완성합니다.",
    picks: RECOMMEND_DB.modern,
    recommendLine: brandPickSentence(RECOMMEND_DB.modern),
  },
  // [왜 — 2026-11-08 사장님이 추가로 제공한 현장 자재 5종] 동화자연마루·
  // 포세린 타일·엑스컴포트 장판·일반 실크벽지·템바보드 — 전부 실제로 흔히
  // 쓰이는 건축자재명이다. 특성 설명·매칭 논리·품번은 사장님이 현장 기준으로
  // 직접 준 것을 그대로 쓴다(findPick으로 위 RECOMMEND_DB의 같은 품번을
  // 재사용해 색 미리보기까지 일치시킴).
  {
    keywords: ["나투스진", "그란데", "사하라 라이트", "동화자연마루"],
    kind: "바닥",
    trait:
      "동화자연마루 나투스진 그란데(사하라 라이트 등 광폭 스톤 마루)는 나무 소재지만 겉모습은 대리석·스톤 타일처럼 넓고 리얼한 질감입니다. 타일의 고급스러움과 마루의 따뜻한 보행감을 동시에 갖춰 최근 바닥재로 많이 선택됩니다.",
    logic:
      "바닥이 타일 느낌의 스톤 질감이므로, 문·샷시에 붉은 기가 도는 우드 필름을 쓰면 바닥과 톤이 어긋나 언밸런스해 보입니다. 바닥 톤에 맞춘 뉴트럴한 색으로 모던함을 살리는 쪽이 실패 없는 정석입니다.",
    picks: [findPick("S212"), findPick("S245")],
    recommendLine: "뉴트럴한 웜 베이지(현대보닥 S212) 또는 완전 무광 퓨어 화이트(현대보닥 S245)로 모던함을 극대화하는 것이 정석입니다.",
  },
  {
    keywords: ["포세린", "포세린타일", "포세린 타일"],
    kind: "바닥",
    trait:
      "포세린 타일(600각 무광 그레이·베이지 타일)은 하이엔드 갤러리나 고급 호텔 라운지에서 쓰는 프리미엄 바닥재입니다. 빛 반사가 없는 매트하고 차분한 표면이 공간을 넓고 차분하게 만들어 줍니다.",
    logic: "바닥의 매트한 질감과 통일감을 주려면 필름도 빛 반사가 거의 없는 완전 무광 솔리드를 매칭해야 공간의 럭셔리함이 유지됩니다.",
    picks: [findPick("S245"), findPick("S208")],
    recommendLine: "완전 무광 퓨어 화이트(현대보닥 S245) 또는 다크 그레이(현대보닥 S208)를 추천합니다.",
  },
  {
    keywords: ["엑스컴포트", "엑스 컴포트"],
    kind: "바닥",
    trait:
      "LX 하우시스 엑스컴포트는 층간소음 방지를 위해 시공하는 5.0mm 두께의 프리미엄 장판입니다. 푹신한 보행감에 타일 같은 무늬를 리얼하게 구현해, 아이·반려동물이 있는 집에서 자주 선택합니다.",
    logic: "부드럽고 포근한 공간을 원하는 의도가 큰 자재라, 쨍한 순백색보다 우유빛이 도는 색으로 눈이 편안한 웜 내추럴 공간을 완성하는 쪽이 어울립니다.",
    picks: [findPick("S115")],
    recommendLine: "우유빛이 도는 크림 화이트(현대보닥 S115)를 추천합니다.",
  },
  {
    keywords: ["실크벽지", "실크 벽지", "개나리", "신한 화이트", "신한화이트"],
    kind: "벽지",
    trait:
      "일반 실크 벽지(개나리·신한 화이트/크림 벽지 등)는 디아망처럼 질감이 깊지는 않지만 평활도가 높고 깔끔해, 어떤 가구와도 잘 어울리는 가장 대중적인 베이스 벽지입니다.",
    logic: "벽지가 튀지 않고 배경 역할을 하므로 필름으로 포인트를 주기 좋습니다. 밝은 오크로 화이트우드 감성을 내거나, 벽지와 같은 톤으로 미니멀하게 감추는 두 방향 모두 잘 맞습니다.",
    picks: [findPick("W861"), findPick("S115")],
    recommendLine: "밝은 오크 우드(현대보닥 W861)로 화이트우드 감성을 내거나, 크림 화이트(현대보닥 S115)로 미니멀하게 감추는 두 방향 모두 좋습니다.",
  },
  {
    keywords: ["템바보드"],
    kind: "벽지",
    trait:
      "템바보드는 반달·직각 모양의 나무가 입체적으로 반복되는 포인트 패널로, 공간에 세련된 볼륨감과 리듬감을 줍니다.",
    logic: "벽면 자체가 이미 입체적이고 시선을 끄는 포인트이므로, 주변 문짝·몰딩은 최대한 눈에 안 띄게 정리해야 템바보드가 완전히 돋보입니다.",
    picks: [findPick("S245")],
    recommendLine: "무광 퓨어 화이트(현대보닥 S245)로 주변을 정리해 템바보드 포인트를 살리는 것을 추천합니다.",
  },
  // [왜 — 2026-11-08 사장님 제공 "공간별 시공 룰"] 자재가 아니라 "싱크대"·
  // "현관문"처럼 공간/부위를 말했을 때도 같은 3단계로 답한다 — 상부장·
  // 하부장처럼 한 공간 안에서 서로 다른 두 부위에 다른 색을 쓰는 투톤
  // 매칭은 recommendLine에서 둘을 분리해 설명한다(단순 "둘 중 하나"가
  // 아니라 "이 부위는 이 색, 저 부위는 저 색").
  {
    keywords: ["싱크대", "상하부장", "상부장", "하부장"],
    kind: "공간",
    trait: "주방 싱크대는 집에서 가장 오염이 잦고 시선이 많이 가는 자리입니다.",
    logic:
      "상부장은 천장·벽지와 이어지는 밝은 화이트로 가면 층고가 높아 보입니다. 하부장은 손이 자주 닿고 오염에 노출되므로, 무게감 있고 오염에 강한 톤으로 상부와 대비를 주는 투톤 매칭이 실패 없는 조합으로 꼽힙니다.",
    picks: [findPick("S245"), findPick("S115"), findPick("S208"), findPick("W293")],
    recommendLine:
      "상부장은 화이트(현대보닥 S245 또는 S115), 하부장은 다크 그레이(S208)·다크 우드(W293) 또는 딥 네이비/딥 그린 같은 포인트 컬러로 매칭하는 것을 추천합니다.",
  },
  {
    keywords: ["현관문", "현관 방화문", "방화문 내측"],
    kind: "공간",
    trait: "현관문은 집에 들어왔을 때의 첫인상을 결정하며, 신발 먼지 등 오염에 가장 취약한 자리입니다.",
    logic:
      "화이트 계열은 때가 쉽게 타 이 자리엔 어울리지 않습니다. 현관 타일과 톤을 맞춘 묵직한 색으로 오염을 가리고 무게감을 주는 쪽이 정석입니다.",
    picks: [findPick("S208"), findPick("S149"), findPick("S219")],
    recommendLine: "다크 그레이(현대보닥 S208), 딥 네이비(S149) 또는 딥 그린(S219)을 추천합니다.",
  },
  {
    keywords: ["모루유리", "모루 유리"],
    kind: "문",
    trait: "모루유리는 세로로 골이 파여 실루엣만 보이고 빛은 통과시키는 유리로, 레트로하면서도 모던한(미드센추리) 느낌을 줍니다.",
    logic: "유리의 세로줄 텍스처 자체가 강한 포인트가 되므로, 문틀(프레임) 필름은 결이 없는 솔리드 단색이어야 유리 무늬와 부딪히지 않습니다.",
    picks: [findPick("S245"), findPick("S208")],
    recommendLine: "퓨어 화이트(현대보닥 S245)로 깔끔하게 빼거나, 금속 프레임 느낌의 다크 그레이(S208)를 매칭하는 것을 추천합니다.",
  },
  {
    keywords: ["테라조"],
    kind: "바닥",
    trait: "테라조 타일은 돌조각이 박힌 듯한 발랄하고 감각적인 무늬의 바닥재로, 자칫하면 시선이 산만해 보일 수 있습니다.",
    logic: "바닥에 이미 점박이 무늬와 여러 색이 섞여 있으므로, 주변 신발장·방문 필름은 가장 차분하고 무늬 없는 색으로 눌러주어야 시선이 중화됩니다.",
    picks: [findPick("S115"), findPick("S212")],
    recommendLine: "웜 화이트(현대보닥 S115) 또는 샌드 베이지(S212)를 추천합니다.",
  },
  // [왜 — 2026-11-08 사장님 제공 추가 바닥·벽지 트렌드] "오늘의집에서 가장
  // 핫한"이라는 표현은 그대로 쓰지 않는다(실시간 확인 불가, 위 principle
  // 그대로 유지) — 대신 자재 자체의 실제 쓰임(무몰딩/히든도어, 침실 톤다운,
  // 강마루, 인더스트리얼)은 널리 알려진 인테리어 지식이라 확신 있게 설명한다.
  {
    keywords: ["페인트 질감", "페인트톤", "무몰딩", "히든도어", "마이너스몰딩", "마이너스 몰딩"],
    kind: "벽지",
    trait: "페인트 질감 벽지(개나리·신한·LX 베스띠 페인트톤 등)는 실제 페인트를 바른 듯 이음새와 질감이 밋밋하고 깔끔해, 무몰딩·히든도어 인테리어에 필수로 쓰입니다.",
    logic: "벽지가 페인트 느낌이므로 문·몰딩에 광택이나 나뭇결이 조금이라도 있으면 바로 어긋나 보입니다. 벽지와 질감이 같은 완전 무광 솔리드로 가야 문과 벽이 하나처럼 보이는 히든도어 효과가 완성됩니다.",
    picks: [findPick("S245"), findPick("PTW01")],
    recommendLine: "완전 무광 솔리드 퓨어 화이트(현대보닥 S245 또는 KCC PTW01)를 추천합니다.",
  },
  {
    keywords: ["포인트 벽지", "어두운 벽지", "침실 포인트", "안방 포인트"],
    kind: "벽지",
    trait: "침실용 포인트 어두운 벽지(딥 그린·딥 네이비·웜 그레이 등)는 안방·서재 벽면을 톤다운시켜 숙면에 도움을 주는 고급스러운 선택입니다.",
    logic: "벽지가 이미 어두운데 문까지 새하얗게 가면 문만 둥둥 떠 보입니다. 벽지와 톤을 맞춘 묵직한 색으로 매칭해야 호텔 객실 같은 무게감이 유지됩니다.",
    picks: [findPick("S208"), findPick("W293")],
    recommendLine: "다크 그레이(현대보닥 S208) 또는 다크 우드(W293)를 추천합니다.",
  },
  {
    keywords: ["강마루", "구정마루", "마뷸러스"],
    kind: "바닥",
    trait: "프리미엄 강마루(구정마루 텍스쳐·마뷸러스 등)는 옹이와 결이 입체적으로 살아 있는 리얼 우드톤 바닥재로, 공간에 자연의 따뜻함을 줍니다.",
    logic: "바닥의 나무 느낌이 이미 강하므로 문짝까지 우드 필름을 쓰면 산장·사우나처럼 보일 수 있습니다. 바닥 우드를 돋보이게 하는 배경 역할로 부드러운 색을 매칭하는 쪽이 실패 없는 국룰입니다.",
    picks: [findPick("S115")],
    recommendLine: "부드러운 크림 화이트(현대보닥 S115)로 화이트우드 밸런스를 맞추는 것을 추천합니다.",
  },
  {
    keywords: ["에폭시", "에폭시 바닥", "인더스트리얼 바닥"],
    kind: "바닥",
    trait: "에폭시·노출 콘크리트 바닥은 카페·스튜디오에서 많이 쓰는 거칠고 빈티지한 회색빛 바닥재입니다.",
    logic: "이 인더스트리얼 감성을 살리려면 따뜻한 우드나 크림 계열은 어울리지 않습니다. 차가운 콘크리트 질감이나, 쨍하게 대비되는 화이트로 힙하고 모던한 느낌을 극대화하는 쪽이 정석입니다.",
    picks: [findPick("NS804"), findPick("S245")],
    recommendLine: "콘크리트 스톤 필름(현대보닥 NS804) 또는 쨍하게 대비되는 퓨어 화이트(S245)를 추천합니다.",
  },
  // [왜 — 2026-11-08 사장님 제공 "하이엔드 시공 디테일"] 문선·아치·냉장고장
  // 리폼·웨인스코팅 — 구조/시공 디테일을 물었을 때도 같은 3단계로 답한다.
  {
    keywords: ["문선", "9mm 문선", "12mm 문선", "미니멀 문틀"],
    kind: "문",
    trait: "9mm·12mm 문선(미니멀 도어 프레임)은 두꺼운 문틀을 뜯어내고 아주 얇게 빼서 벽과 문이 평면처럼 보이게 만드는 최신 미니멀리즘 시공입니다.",
    logic: "문틀이 얇아진 만큼 시선이 분산되면 안 되므로, 벽지 색상과 거의 일치하는 솔리드 무광 필름으로 문틀의 존재감을 지우는 것이 핵심입니다.",
    picks: [findPick("S245"), findPick("S115")],
    recommendLine: "화이트 벽지라면 퓨어 화이트(현대보닥 S245), 크림 벽지라면 웜 화이트(S115)를 매칭하는 것을 추천합니다.",
  },
  {
    keywords: ["아치형 게이트", "아치형 문", "아치 게이트", "아치형"],
    kind: "문",
    trait: "아치형 게이트는 직각의 딱딱한 문틀 대신 윗부분을 둥근 아치형으로 목공 작업해 부드럽고 이국적인 포인트를 주는 시공입니다.",
    logic: "아치 자체가 이미 시각적 포인트이므로 너무 튀는 색상은 피해야 합니다. 공간을 따뜻하게 안아주는 톤이나, 벽과 일체감 있는 톤 중 하나로 확실하게 가는 것이 국룰입니다.",
    picks: [findPick("W861"), findPick("S115")],
    recommendLine: "따뜻한 오크 우드(현대보닥 W861)로 카페 같은 코지한 감성을 살리거나, 크림 화이트(S115)로 벽과 일체감 있게 깔끔히 마감하는 것을 추천합니다.",
  },
  {
    keywords: ["비스포크", "오브제", "냉장고장 리폼"],
    kind: "공간",
    trait: "비스포크·오브제 같은 가전 맞춤형 냉장고장 리폼은 기존 냉장고장을 새로 들인 가전제품의 컬러·라인에 맞춰 리폼하는 시공입니다.",
    logic: "가전제품의 매트한 패널과 이질감이 없어야 하므로 나뭇결이나 유광은 피하고, 패널과 가장 흡사한 무광 솔리드 컬러로 가야 '빌트인'처럼 보입니다.",
    picks: [findPick("S245"), findPick("S212")],
    recommendLine: "완전 무광 퓨어 화이트(현대보닥 S245) 또는 톤다운된 샌드 베이지(S212)를 추천합니다.",
  },
  {
    keywords: ["웨인스코팅"],
    kind: "벽지",
    trait: "웨인스코팅은 벽면에 액자 프레임 형태의 몰딩을 덧대 유럽풍의 클래식하고 우아한 분위기를 연출하는 디테일입니다.",
    logic: "클래식한 디테일이라 가벼운 우드톤은 어울리지 않습니다. 우아한 톤이나 묵직한 톤 중 하나로 확실하게 매칭해야 부티크 호텔 같은 분위기가 완성됩니다.",
    picks: [findPick("S115"), findPick("S208"), findPick("W293")],
    recommendLine: "정통 프렌치풍 크림 화이트(S115)로 우아하게 가거나, 묵직한 딥 그레이(S208)나 다크 우드(W293)로 무게감을 주는 것을 추천합니다.",
  },
  // [왜 — 2026-11-08 사장님 제공 "인테리어 마스터 DB"] 조명 온도(켈빈)·
  // 하이엔드 구조(스텝도어)·프리미엄 자재(유럽미장·대형 타일·세라믹 상판)·
  // 시각적 착시(층고) — 여러 키워드가 한 문장에 같이 들어오면 findMaterials가
  // 해당하는 카드를 전부 찾아 보여주므로, 조명+자재+공간감을 같이 물어도
  // 각 관점의 답이 한 번에 함께 나온다.
  {
    keywords: ["유럽미장", "유럽 미장", "발페인트", "스투코"],
    kind: "벽지",
    trait: "유럽 미장(발페인트·스투코 등 텍스처 벽면)은 붓 터치와 거친 질감이 살아있는 예술적인 벽면입니다.",
    logic: "벽 자체가 이미 예술 작품이므로 문짝 필름이 무늬나 결로 경쟁하면 지저분해 보입니다. 가장 차분하고 무늬 없는 솔리드 무광 단색으로 벽을 돋보이게 해야 합니다. 우드 필름은 피하는 것이 정석입니다.",
    picks: [findPick("S245"), findPick("S208")],
    recommendLine: "퓨어 화이트(현대보닥 S245) 또는 다크 그레이(S208) 같은 솔리드 무광 단색을 추천합니다.",
  },
  {
    keywords: ["1200각", "대형 포세린", "광폭 타일", "대형 타일"],
    kind: "바닥",
    trait: "1200각 이상 대형 포세린 타일(광폭 타일)은 타일 선(메지)이 적어 공간이 거대해 보이는 하이엔드 바닥재입니다.",
    logic: "이 거대한 공간감을 흩트리지 않으려면 문·샷시를 조각조각 다른 색으로 나누지 말고, 벽지·필름·걸레받이를 완벽한 원톤(One-tone)으로 통일하는 것이 정석입니다.",
    picks: [findPick("S245"), findPick("S115")],
    recommendLine: "타일 색이 연한 그레이·화이트 계열이라면 퓨어 화이트(S245)나 웜 화이트(S115) 한 가지로 문·샷시·걸레받이를 전부 통일하는 것을 추천합니다.",
  },
  {
    keywords: ["세라믹 상판", "칸스톤", "이날코", "세라믹 주방"],
    kind: "공간",
    trait: "세라믹 주방 상판(칸스톤·이날코 등)은 리얼한 돌 질감의 세라믹 소재입니다.",
    logic: "상판의 돌 질감과 이질감이 없으려면, 싱크대 하부장 필름을 상판의 베이스 컬러(바탕색)와 비슷한 톤의 솔리드로 맞추는 '톤온톤' 기법이 가장 세련됩니다.",
    picks: [findPick("S208"), findPick("S212")],
    recommendLine: "상판이 그레이 계열이면 다크 그레이(S208), 베이지 계열이면 샌드 베이지(S212)로 톤을 맞추는 것을 추천합니다.",
  },
  {
    keywords: ["스텝도어", "스텝 도어"],
    kind: "문",
    trait: "스텝 도어는 문선을 없애고 문이 벽 안쪽으로 한 계단(Step) 쏙 들어가게 만드는 최신 유행 도어입니다.",
    logic: "문이 들어간 틈에 그림자가 지며 입체감이 생기므로, 빛을 반사하는 유광 필름을 쓰면 그림자 라인이 지저분하게 보입니다. 빛 반사가 없는 완전 무광 필름을 써야 그림자 라인이 고급스럽게 살아납니다.",
    picks: [findPick("S245"), findPick("S208")],
    recommendLine: "완전 무광 퓨어 화이트(S245) 또는 다크 그레이(S208)를 추천합니다.",
  },
  {
    keywords: ["층고가 낮", "층고 낮", "좁아 보여", "좁고 낮"],
    kind: "공간",
    trait: "집이 좁고 층고가 낮을 때는 공간이 더 답답하게 느껴지기 쉽습니다.",
    logic: "바닥(어둡게) → 벽(중간 톤) → 천장(밝게) 순으로 점점 밝아지게 시공해야 안정감과 개방감이 함께 생깁니다. 이때 샷시·문짝 필름은 벽·천장 색에 맞춰 화이트 톤으로 끌어올려야 시야가 트여 넓어 보입니다.",
    picks: [findPick("S245"), findPick("S115")],
    recommendLine: "샷시·문짝은 퓨어 화이트(S245) 또는 웜 화이트(S115)로 밝게 끌어올리는 것을 추천합니다.",
  },
  {
    keywords: ["주백색", "4000k", "4000케"],
    kind: "조명",
    trait: "주백색(4000K) 조명은 태양광과 가장 비슷한 따뜻한 하얀 불빛으로, 하이엔드 인테리어의 기본 조명입니다.",
    logic: "모든 필름 색상을 가장 정확하고 예쁘게 보여줍니다. 퓨어 화이트를 부드럽게 만들고, 크림 화이트의 고급스러움을 극대화합니다.",
    picks: [findPick("S245"), findPick("S115")],
    recommendLine: "퓨어 화이트(S245)나 크림 화이트(S115) 모두 이 조명 아래서 가장 예쁘게 나옵니다.",
  },
  {
    keywords: ["전구색", "3000k", "3000케"],
    kind: "조명",
    trait: "전구색(3000K) 조명은 오렌지빛이 도는 따뜻한 불빛으로, 호텔 라운지 같은 느낌을 줍니다.",
    logic: "우드 필름과 웜 베이지에 비추면 공간이 미친 듯이 아늑해집니다. 다만 퓨어 화이트에 비추면 노랗게 떠 보일 수 있으니 주의해야 합니다.",
    picks: [findPick("W861"), findPick("W293"), findPick("S212")],
    recommendLine: "오크 우드(W861)·다크 우드(W293)·웜 베이지(S212) 계열을 추천하고, 퓨어 화이트(S245)는 피하는 것이 좋습니다.",
  },
  {
    keywords: ["주광색", "6000k", "6000케"],
    kind: "조명",
    trait: "주광색(6000K) 조명은 형광등 같은 푸른빛의 하얀 불빛입니다. 요즘 주거 공간에서는 차갑고 사무실 같은 느낌이라 잘 쓰지 않습니다.",
    logic: "이 조명 아래서는 웜 화이트를 쓰면 색이 탁해 보입니다. 차라리 쨍한 퓨어 화이트나 그레이 톤으로 시크함을 살리는 것이 낫습니다.",
    picks: [findPick("S245"), findPick("S208")],
    recommendLine: "쨍한 퓨어 화이트(S245)나 다크 그레이(S208)를 추천하고, 웜 화이트(S115)는 피하는 것이 좋습니다.",
  },
  // [왜 — 2026-11-08 사장님 제공 "하이엔드 포인트 필름 DB"] 기본(화이트·우드·
  // 그레이)만으로는 밋밋하다는 고객에게 "베이스 1개 + 포인트 1개" 믹스를
  // 제안한다. "밋밋"을 공통 키워드로 넣어 네 가지가 한 번에 뜨게 해, 현장에서
  // 사장님이 상황에 맞는 걸 고를 수 있게 한다. 메탈·파스텔·패브릭은 사장님이
  // 구체 품번을 안 줬으므로 품번을 지어내지 않고(색상 말고는 S245/S115/W861
  // 같은 "베이스" 색만 기존 데이터에서 인용), 포인트 자재 자체는 "현대보닥
  // 메탈 시리즈"처럼 사장님이 쓴 그대로의 표현만 쓴다.
  {
    keywords: ["메탈 필름", "스테인리스 필름", "헤어라인", "메탈 포인트", "밋밋"],
    kind: "포인트",
    trait: "헤어라인(미세한 긁힘 무늬) 메탈·리얼 스테인리스 필름은 차가운 금속 특유의 광택이 살아있는 프리미엄 포인트 자재입니다.",
    logic: "모던하고 도시적인 느낌을 원할 때 싱크대 하부장이나 아일랜드 식탁 한 곳에만 단독으로 쓰고, 주변은 퓨어 화이트로 쫙 빼야 메탈의 질감만 돋보입니다. 베이스(화이트) 하나 + 포인트(메탈) 하나로 믹스하는 것이 핵심입니다.",
    picks: [findPick("S245")],
    recommendLine: "주방 전체는 퓨어 화이트(현대보닥 S245)로 베이스를 깔고, 싱크대 하부장이나 아일랜드 한 곳만 헤어라인 메탈·리얼 스테인리스 필름(현대보닥 메탈 시리즈)으로 포인트를 주는 것을 추천합니다. 정확한 품번은 메탈 시리즈 샘플집에서 함께 확인해 주세요.",
  },
  {
    keywords: ["중문 포인트", "포인트 도어", "욕실문 포인트", "밋밋"],
    kind: "포인트",
    trait: "딥 그린·딥 네이비는 영국 클래식 인테리어나 부티크 호텔에서 쓰는 묵직하고 고급스러운 유색 포인트 컬러입니다.",
    logic: "집 전체가 크림·베이지 톤으로 밋밋할 때, 현관문 내측이나 중문·욕실문 딱 하나에만 시공해 시선을 사로잡는 포인트를 줍니다. 무광 황동(골드) 손잡이와 매칭하면 만족도가 특히 높습니다.",
    picks: [findPick("S219"), findPick("S149")],
    recommendLine: "중문이나 욕실문 하나에만 딥 그린(현대보닥 S219) 또는 딥 네이비(S149)를 쓰고, 무광 황동 손잡이로 마무리하는 것을 추천합니다.",
  },
  {
    keywords: ["버터옐로우", "버터 옐로우", "소프트민트", "소프트 민트", "파스텔", "밋밋"],
    kind: "포인트",
    trait: "버터 옐로우·소프트 민트는 흰색이 많이 섞인 부드러운 파스텔톤으로, 최근 신혼부부 인테리어에서 아이방·다이닝룸 포인트로 자주 쓰입니다.",
    logic: "쨍한 원색이 아니라 흰색이 섞인 부드러운 톤이 핵심이라 웜 화이트나 밝은 오크 바닥과 잘 어울립니다. 주방 수납장 한 칸이나 아이방 문짝 하나에만 시공해 귀엽고 감각적인 느낌을 살립니다.",
    picks: [findPick("S115"), findPick("W861")],
    recommendLine: "웜 화이트(S115)나 밝은 오크(W861)를 베이스로 두고, 주방 수납장 한 칸이나 아이방 문짝에 버터 옐로우·소프트 민트 파스텔 필름으로 포인트를 주는 것을 추천합니다. 정확한 품번은 파스텔 라인 샘플에서 확인해 주세요.",
  },
  {
    keywords: ["패브릭 필름", "레더 필름", "가죽 질감", "직물 질감", "밋밋"],
    kind: "포인트",
    trait: "패브릭·레더 질감 필름은 실제 직물이나 가죽을 만지는 듯한 촉감을 구현한 최고급 포인트 필름입니다.",
    logic: "침실 가벽이나 붙박이장 문짝에 시공하면, 차가운 나무·플라스틱 느낌 대신 호텔 침실처럼 포근하고 럭셔리한 분위기를 연출할 수 있습니다.",
    picks: [],
    recommendLine: "침실 가벽이나 붙박이장 문짝 한 면에 패브릭·레더 질감 필름을 시공해 포근한 포인트를 주는 것을 추천합니다. 정확한 품번은 패브릭·레더 라인 샘플에서 확인해 주세요.",
  },
];

function findMaterials(query: string): MaterialKnowledge[] {
  const normalized = query.replace(/\s/g, "").toLowerCase();
  return MATERIAL_KB.filter((m) => m.keywords.some((k) => normalized.includes(k.replace(/\s/g, "").toLowerCase())));
}

/** 브랜드+품번이 같으면 하나만 남긴다 — 바닥·벽지 매칭에서 같은 품번이
 *  중복으로 뽑히는 경우가 있어(예: 두 자재가 같은 추천 품번을 공유) 칩이
 *  겹쳐 보이지 않게 정리한다. */
function dedupePicks(picks: BrandPick[]): BrandPick[] {
  const seen = new Set<string>();
  const out: BrandPick[] = [];
  for (const p of picks) {
    const key = `${p.brand}-${p.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** VirtualConstructionView에 넘길 질감·광택 추정 — 실제 제품 스펙 데이터가
 *  없어 이름으로 추론한다(예: "메탈"/"스테인리스" 포함 → metal). 나중에
 *  진짜 제품 DB에 광택 스펙이 생기면 이 함수를 그 값으로 교체해야 한다. */
function inferMaterialTraits(pick: BrandPick): { texture: "solid" | "wood" | "metal"; glossiness: number } {
  if (/메탈|스테인리스|헤어라인/.test(pick.name)) return { texture: "metal", glossiness: 65 };
  if (/우드|오크|월넛|마루/.test(pick.name)) return { texture: "wood", glossiness: 20 };
  return { texture: "solid", glossiness: 0 };
}

function groupByBrand(swatches: PatternSwatch[]): { label: string; items: PatternSwatch[] }[] {
  const groups: { label: string; items: PatternSwatch[] }[] = [];
  for (const s of swatches) {
    const label = s.brand ?? "기본 색상";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(s);
    else groups.push({ label, items: [s] });
  }
  return groups;
}

/** 작은 원 하나로는 "느낌"이 잘 안 산다 — 눌러서 화면을 거의 채우는 큰 색 면으로
 *  보여줘야 고객이 실제로 어떤 느낌인지 가늠할 수 있다. 실물 견본 사진을 올려둔
 *  품번이면(/admin/swatches) 근사 색 대신 그 사진을 그대로 보여준다. */
function SwatchDetail({ swatch, photoUrl, onClose }: { swatch: PatternSwatch; photoUrl?: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 p-4" onClick={onClose}>
      <div
        className="mt-auto w-full overflow-hidden rounded-[28px] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {photoUrl ? (
          <AssetImage src={photoUrl} alt={swatch.name} className="h-[46vh] w-full object-cover" />
        ) : (
          <div className="h-[46vh] w-full" style={{ backgroundColor: swatch.colorHex }} />
        )}
        <div className="flex items-start justify-between gap-3 p-6">
          <div>
            <p className="text-[20px] font-extrabold tracking-tight text-[#191f28]">{swatch.name}</p>
            <p className="mt-1 text-[13px] text-[#5b6573]">
              {swatch.brand ? `${swatch.brand}${swatch.code ? ` · ${swatch.code}` : ""}` : "기본 색상"}
              {" · "}
              {TONE_LABELS[swatch.tone]}
              {photoUrl ? " · 실물 사진" : " · 근사 색"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f2f4f6] text-[#4e5968]"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 플래너 2~3단계용 — 부위 하나(문/샷시/싱크대)의 추천 이유와 선택 칩을 보여준다.
 *  고객이 칩을 누르면 그 부위의 최종 색이 확정된다(칩 테두리로 선택 표시). */
function PlannerPartCard({
  label,
  reason,
  candidates,
  selected,
  onSelect,
}: {
  label: string;
  reason: string;
  candidates: BrandPick[];
  selected: BrandPick | null;
  onSelect: (pick: BrandPick) => void;
}) {
  return (
    <div className="rounded-2xl bg-[#f8f9fa] p-4">
      <p className="text-[13.5px] font-bold text-[#191f28]">{label}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[#5b6573]">{reason}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {candidates.map((p) => {
          const isSelected = selected?.brand === p.brand && selected?.code === p.code;
          return (
            <button
              key={`${p.brand}-${p.code}`}
              type="button"
              onClick={() => onSelect(p)}
              className={`flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1.5 transition-colors ${
                isSelected ? "border-indigo-600 bg-indigo-50" : "border-transparent bg-white"
              }`}
            >
              <span className="h-4 w-4 shrink-0 rounded-full border border-black/5" style={{ backgroundColor: p.approxHex }} />
              <span className="whitespace-nowrap text-[11px] font-bold">
                {p.brand} {p.code}
              </span>
              {isSelected && <span className="text-[11px] font-bold text-indigo-600">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ColorsPage() {
  const [tone, setTone] = useState<PatternSwatch["tone"] | "all">("all");
  const [opened, setOpened] = useState<PatternSwatch | null>(null);
  // 사장님이 /admin/swatches에서 올린 실물 견본 사진 — 올려둔 품번만 들어있고,
  // 없는 품번은 기존처럼 근사 색 블록으로 보여준다.
  const [swatchPhotos, setSwatchPhotos] = useState<Record<string, string>>({});
  useEffect(() => {
    getSwatchPhotos().then(setSwatchPhotos).catch(() => setSwatchPhotos({}));
  }, []);

  // /admin/swatch-scan에서 책자 쪽을 스캔해 쌓은 실물 견본들 — 24개 고정 목록과는
  // 별개로 계속 늘어난다. 코드를 못 읽은(needs_review) 항목은 흐리게 표시해 아직
  // 확인 전이라는 걸 알 수 있게 한다.
  const [scannedEntries, setScannedEntries] = useState<SwatchScanEntry[]>([]);
  const [openedScan, setOpenedScan] = useState<SwatchScanEntry | null>(null);
  useEffect(() => {
    getSwatchScans().then(setScannedEntries).catch(() => setScannedEntries([]));
  }, []);
  const scannedByBrand = useMemo(() => {
    const map = new Map<string, SwatchScanEntry[]>();
    for (const e of scannedEntries) {
      const list = map.get(e.brand) ?? [];
      list.push(e);
      map.set(e.brand, list);
    }
    return [...map.entries()];
  }, [scannedEntries]);
  const [query, setQuery] = useState("");
  // null = 아직 검색 안 함, "none" = 검색했지만 못 알아들음, 그 외엔 짚어낸 톤.
  const [answer, setAnswer] = useState<PatternSwatch["tone"] | "none" | null>(null);

  // 맞춤 추천(바닥·벽지·분위기) 입력값.
  const [floorColor, setFloorColor] = useState("");
  const [wallpaper, setWallpaper] = useState("");
  const [mood, setMood] = useState<MoodPreset | null>(null);

  // 자재 키워드로 상담하기("벽지는 디아망으로, 바닥은 블랙 마루로...").
  const [materialQuery, setMaterialQuery] = useState("");
  // null = 아직 분석 안 함, [] = 분석했지만 아는 자재가 없음.
  const [materialMatches, setMaterialMatches] = useState<MaterialKnowledge[] | null>(null);

  // [왜 — 2026-11-08 "4단계 UX 흐름"] 바닥·벽지를 먼저 받고 → 부위별(문/샷시/
  // 싱크대) 추천을 보여준 뒤 → 고객이 칩을 눌러 확정하면 → 그 조합을 CSS로
  // 그린 배색 미리보기를 보여준다. 사진처럼 합성하는 AI 렌더링이 아니라
  // 색상 블록으로 "느낌"만 바로 보여주는 것 — 느리고 비용 드는 이미지 생성
  // 없이 현장에서 즉시 쓸 수 있어야 한다는 원칙([[image-backup-before-overwrite]]
  // 와 같은 결의 "AI 이미지 생성은 비용·속도 문제" 판단을 그대로 따른다).
  const [plannerFloor, setPlannerFloor] = useState("");
  const [plannerWall, setPlannerWall] = useState("");
  const [plannerBaseConfirmed, setPlannerBaseConfirmed] = useState(false);
  // [왜 — 2026-11-09 "추가는 걸레받이·몰딩·붙박이장·신발장·중문·현관문·장식장"]
  // 방문/샷시/싱크대 3곳은 그대로 "기본"(필수)으로 두고, 나머지 7곳은 "추가
  // (선택)"로 둔다 — 매번 10곳을 다 고르게 하면 현장에서 쓰기엔 너무 번거롭다.
  // PLANNER_PART_LABELS는 탭·영수증에 쓰는 짧은 이름, estimatorCode가 있는
  // 부위만 스마트 견적 합계에 들어간다(걸레받이·장식장은 이 코드베이스의
  // 부분상세견적에 해당하는 단일 품목 가격이 없어 지어내지 않고 견적에서 뺀다).
  const PLANNER_PART_LABELS = {
    door: "방문",
    sash: "샷시",
    sink: "싱크대 하부장",
    baseboard: "걸레받이",
    molding: "몰딩",
    wardrobe: "붙박이장",
    shoe: "신발장",
    middleDoor: "중문",
    frontDoor: "현관문",
    display: "장식장",
  } as const;
  type PlannerPartKey = keyof typeof PLANNER_PART_LABELS;
  const PLANNER_EXTRA_ESTIMATOR_CODES: Partial<Record<PlannerPartKey, string>> = {
    molding: "MOLDING_FLAT",
    wardrobe: "WARDROBE_SET",
    shoe: "SHOE_CABINET",
    middleDoor: "MIDDLE_DOOR",
    frontDoor: "FIRE_DOOR_SINGLE",
  };
  const [plannerPicks, setPlannerPicks] = useState<Record<PlannerPartKey, BrandPick | null>>({
    door: null,
    sash: null,
    sink: null,
    baseboard: null,
    molding: null,
    wardrobe: null,
    shoe: null,
    middleDoor: null,
    frontDoor: null,
    display: null,
  });
  const [plannerExtraOpen, setPlannerExtraOpen] = useState(false);
  const [showPlannerMockup, setShowPlannerMockup] = useState(false);
  // "AI 가상 시공(실제 사진 합성)"을 어느 부위로 시연할지 — 사진 업로드는
  // 한 번에 하나씩만 자연스러우므로(현장에서 매번 여러 장을 다 찍진 않는다)
  // 지금까지 색을 고른 부위 중 하나를 고르게 한다.
  const [plannerVcPart, setPlannerVcPart] = useState<PlannerPartKey>("sash");

  const plannerAnalysis = useMemo(() => {
    const floorMatches = findMaterials(plannerFloor);
    const wallMatches = findMaterials(plannerWall);
    const sinkEntry = [...floorMatches, ...wallMatches].find((m) => m.keywords.includes("싱크대"));
    // 중문·현관문은 이미 자재 DB에 전용 룰이 있다(공간별 시공 룰 — "중문 포인트",
    // "현관문") — 여기서 새로 지어내지 않고 그대로 재사용한다.
    const middleDoorEntry = MATERIAL_KB.find((m) => m.keywords.includes("중문 포인트"));
    const frontDoorEntry = MATERIAL_KB.find((m) => m.keywords.includes("현관문"));
    const wallLabel = plannerWall.trim() || "벽지";
    const floorLabel = plannerFloor.trim() || "바닥";

    const doorCandidates = dedupePicks([
      ...wallMatches.flatMap((m) => m.picks),
      ...floorMatches.flatMap((m) => m.picks),
      findPick("S245"),
      findPick("S208"),
    ]).slice(0, 4);
    const sashCandidates = dedupePicks([
      ...floorMatches.flatMap((m) => m.picks),
      ...wallMatches.flatMap((m) => m.picks),
      findPick("S245"),
      findPick("S208"),
    ]).slice(0, 4);
    // 싱크대는 "상부는 밝게, 하부는 무게감"이 고정 룰이라 상부는 항상
    // 화이트로 두고, 고객은 하부장 포인트 색만 고른다.
    const sinkCandidates = dedupePicks(
      sinkEntry ? sinkEntry.picks.slice(2) : [findPick("S208"), findPick("W293"), findPick("S212")]
    ).slice(0, 4);
    const baseboardCandidates = dedupePicks([
      ...wallMatches.flatMap((m) => m.picks),
      ...floorMatches.flatMap((m) => m.picks),
      findPick("S245"),
    ]).slice(0, 4);
    const moldingCandidates = dedupePicks([...wallMatches.flatMap((m) => m.picks), findPick("S245"), findPick("S208")]).slice(0, 4);
    const wardrobeCandidates = dedupePicks([...wallMatches.flatMap((m) => m.picks), ...doorCandidates]).slice(0, 4);
    const shoeCandidates = dedupePicks([findPick("S208"), ...floorMatches.flatMap((m) => m.picks), findPick("S115")]).slice(0, 4);
    const middleDoorCandidates = dedupePicks(middleDoorEntry ? middleDoorEntry.picks : [findPick("S219"), findPick("S149")]).slice(0, 4);
    const frontDoorCandidates = dedupePicks(
      frontDoorEntry ? frontDoorEntry.picks : [findPick("S208"), findPick("S149"), findPick("S219")]
    ).slice(0, 4);
    const displayCandidates = dedupePicks([findPick("S219"), findPick("S149"), ...wallMatches.flatMap((m) => m.picks)]).slice(0, 4);

    return {
      floorMatches,
      wallMatches,
      wallLabel,
      floorLabel,
      door: {
        candidates: doorCandidates,
        reason: `방문·문틀은 ${wallLabel}와 통일감을 주는 밝기로 고르면 공간이 넓어 보이고, 또렷하게 대비를 주면 포인트가 됩니다.`,
      },
      sash: {
        candidates: sashCandidates,
        reason: `샷시는 ${floorLabel} 바닥의 분위기를 이어가는 색으로 고르면 통일감이 생깁니다.`,
      },
      sink: {
        candidates: sinkCandidates,
        reason: sinkEntry
          ? sinkEntry.recommendLine
          : "싱크대는 상부장을 밝은 화이트로, 하부장을 무게감 있는 색으로 매칭하는 투톤이 실패 없는 조합입니다. 상부는 화이트로 고정하고, 아래에서 하부장 색만 골라 보세요.",
      },
      baseboard: {
        candidates: baseboardCandidates,
        reason: "걸레받이는 벽과 통일감을 주면 눈에 덜 띄어 깔끔해지고, 바닥과 맞추면 바닥이 더 넓어 보이는 효과가 있습니다.",
      },
      molding: {
        candidates: moldingCandidates,
        reason: "몰딩은 벽·천장과 통일된 밝은 색으로 가면 층고가 높아 보이고, 진한 색으로 가면 입체감 있는 포인트가 됩니다.",
      },
      wardrobe: {
        candidates: wardrobeCandidates,
        reason: "붙박이장은 벽과 통일감을 주는 밝은 색이 기본이며, 방문과 같은 색으로 맞추면 공간이 한 톤으로 정리됩니다.",
      },
      shoe: {
        candidates: shoeCandidates,
        reason: "신발장은 현관 자리라 오염에 강한 톤이 좋습니다 — 바닥과 맞추면 통일감이, 다크 그레이로 가면 깔끔하게 정리됩니다.",
      },
      middleDoor: {
        candidates: middleDoorCandidates,
        reason: middleDoorEntry ? middleDoorEntry.logic : "중문은 딥 그린·딥 네이비 같은 묵직한 포인트 컬러를 쓰면 시선을 사로잡는 효과가 있습니다.",
      },
      frontDoor: {
        candidates: frontDoorCandidates,
        reason: frontDoorEntry ? frontDoorEntry.logic : "현관문은 오염에 취약해 화이트 계열은 피하고, 묵직한 색으로 가는 것이 정석입니다.",
      },
      display: {
        candidates: displayCandidates,
        reason: "장식장은 포인트를 주고 싶다면 과감한 색(딥그린·딥네이비)을, 차분하게 가고 싶다면 벽과 통일감을 주는 색을 추천합니다.",
      },
    };
  }, [plannerFloor, plannerWall]);

  const plannerReady = plannerPicks.door && plannerPicks.sash && plannerPicks.sink;

  // [왜 — 2026-11-08 "스마트 자동 견적 계산기"] 가격은 estimator_app(부분상세견적)의
  // 실제 단가표 한 곳만 본다(lib/api.ts의 "화면에 같은 가격을 또 적어 두면 두 곳이
  // 어긋난다" 원칙) — 여기서 새로 숫자를 지어내지 않는다. 사장님이 단가를 바꾸면
  // 이 견적도 그대로 따라간다. 걸레받이·장식장은 이 단가표에 해당하는 단일
  // 품목이 없어(estimator_app/app.py 참고) 품번은 추천해도 견적 합계에는
  // 넣지 않고 "현장 확인 후 별도 산정"으로 안내한다.
  const [estimatorItems, setEstimatorItems] = useState<Record<string, EstimatorItem> | null>(null);
  useEffect(() => {
    getEstimatorItems().then(setEstimatorItems).catch(() => setEstimatorItems(null));
  }, []);
  const plannerQuote = useMemo(() => {
    if (!estimatorItems) return null;
    const door = estimatorItems.DOOR_SET;
    const sash = estimatorItems.SASH_SMALL;
    const sink = estimatorItems.SINK_L;
    if (!door || !sash || !sink) return null;
    const extraLines = (Object.keys(PLANNER_EXTRA_ESTIMATOR_CODES) as PlannerPartKey[])
      .filter((key) => plannerPicks[key])
      .map((key) => estimatorItems[PLANNER_EXTRA_ESTIMATOR_CODES[key]!])
      .filter((item): item is EstimatorItem => !!item);
    const extraTotal = extraLines.reduce((sum, item) => sum + item.price, 0);
    const uncounted = (["baseboard", "display"] as PlannerPartKey[]).filter((key) => plannerPicks[key]);
    return {
      door,
      sash,
      sink,
      extraLines,
      uncounted,
      total: door.price + sash.price + sink.price + extraTotal,
    };
  }, [estimatorItems, plannerPicks]);
  // 숫자는 "AI 가상 시공 결과 보기"를 눌러 mockup이 뜨는 순간부터 스르륵
  // 올라가야 의미가 있다 — 그 전까지는 목표값을 0으로 묶어 둔다.
  const plannerQuoteTotal = useCountUp(showPlannerMockup ? plannerQuote?.total ?? 0 : 0);

  function handleSearch() {
    const guessed = guessTone(query.trim());
    if (guessed) {
      setTone(guessed);
      setAnswer(guessed);
    } else {
      setAnswer("none");
    }
  }

  function handleMaterialAnalyze() {
    setMaterialMatches(findMaterials(materialQuery));
  }

  const filtered = useMemo(
    () => (tone === "all" ? ALL_PATTERN_SWATCHES : ALL_PATTERN_SWATCHES.filter((s) => s.tone === tone)),
    [tone]
  );
  const groups = useMemo(() => groupByBrand(filtered), [filtered]);

  // 답변은 항상 발주 가능한 실제 품번(현대보닥) 기준으로 말해준다 — 기본 10색은
  // 품번이 없어 고객에게 "이건 뭐예요?" 되물어도 답해 줄 자재 정보가 없다.
  const bodaqPicks = useMemo(() => {
    if (!answer || answer === "none") return [];
    return ALL_PATTERN_SWATCHES.filter((s) => s.tone === answer && s.brand).slice(0, 3);
  }, [answer]);

  useSwipeNavigate("/colors", !opened);

  return (
    <main className="min-h-screen min-h-[100dvh] bg-[#f2f4f6] text-[#191f28]">
      <div className="mx-auto max-w-[480px] px-4 pb-16 pt-4">
        <header className="mb-5">
          <Link
            href="/"
            className="-ml-2 inline-flex h-11 items-center gap-1 rounded-xl px-2 text-[14px] font-medium text-[#4e5968] transition-colors active:bg-black/5"
          >
            <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
            메인으로
          </Link>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-[-0.03em]">색상 상담</h1>
          <p className="mt-1.5 text-[15px] text-[#5b6573]">
            고객이 말한 느낌을 그대로 입력하거나, 아래에서 눌러 바로 걸러 보세요.
          </p>
        </header>

        <section className="rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(25,31,40,0.04)]">
          <h2 className="text-[16px] font-bold">맞춤 추천</h2>
          <p className="mt-1 text-[13px] text-[#5b6573]">
            바닥·벽지를 적어 두면(생략 가능) 분위기에 맞춰 추천 멘트에 그대로 반영됩니다.
          </p>
          <div className="mt-3 space-y-2.5">
            <input
              type="text"
              value={floorColor}
              onChange={(e) => setFloorColor(e.target.value)}
              placeholder="바닥 색상 (예: 화이트, 라이트 우드)"
              className="h-11 w-full rounded-xl border border-[#e5e8eb] bg-[#f8f9fa] px-3.5 text-[14px] outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              value={wallpaper}
              onChange={(e) => setWallpaper(e.target.value)}
              placeholder="벽지 종류 (예: 무지 화이트, 베이지 톤)"
              className="h-11 w-full rounded-xl border border-[#e5e8eb] bg-[#f8f9fa] px-3.5 text-[14px] outline-none focus:border-indigo-500"
            />
          </div>
          <p className="mb-2 mt-3.5 text-[12.5px] font-bold text-[#8b95a1]">원하는 분위기</p>
          <div className="flex flex-wrap gap-2">
            {MOOD_PRESETS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMood(m)}
                className={`h-9 rounded-full px-3.5 text-[13.5px] font-bold transition-colors ${
                  mood?.key === m.key ? "bg-indigo-600 text-white" : "bg-[#f2f4f6] text-[#4e5968]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mood && (
            <div className="mt-4 rounded-2xl bg-indigo-600 px-4 py-4 text-white">
              <p className="text-[13.5px] leading-relaxed">
                {mood.reason(floorColor.trim(), wallpaper.trim())}{" "}
                {brandPickSentence(RECOMMEND_DB[mood.key] ?? [])}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {(RECOMMEND_DB[mood.key] ?? []).map((p) => (
                  <div key={`${p.brand}-${p.code}`} className="flex items-center gap-2 rounded-xl bg-white px-2.5 py-2 text-[#191f28]">
                    <span
                      className="h-8 w-8 shrink-0 rounded-full border border-black/5"
                      style={{ backgroundColor: p.approxHex }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-bold leading-tight">
                        {p.brand} {p.code}
                      </p>
                      <p className="truncate text-[11px] text-[#8b95a1]">{p.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="mt-5 rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(25,31,40,0.04)]">
          <h2 className="text-[16px] font-bold">AI 시공 색상 플래너</h2>
          <p className="mt-1 text-[13px] text-[#5b6573]">
            바닥·벽지를 먼저 적고, 부위별 추천 색을 눌러 고르면 전체 배색을 한눈에 볼 수 있습니다.
          </p>

          {/* 1단계: 기본 바탕 */}
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={plannerFloor}
              onChange={(e) => {
                setPlannerFloor(e.target.value);
                setPlannerBaseConfirmed(false);
                setShowPlannerMockup(false);
              }}
              placeholder="바닥재 (예: 포세린 타일, 오크 마루)"
              className="h-12 w-full rounded-2xl border border-[#e5e8eb] bg-[#f8f9fa] px-4 text-[15px] outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              value={plannerWall}
              onChange={(e) => {
                setPlannerWall(e.target.value);
                setPlannerBaseConfirmed(false);
                setShowPlannerMockup(false);
              }}
              placeholder="벽지 (예: 디아망, 유럽 미장)"
              className="h-12 w-full rounded-2xl border border-[#e5e8eb] bg-[#f8f9fa] px-4 text-[15px] outline-none focus:border-indigo-500"
            />
            {!plannerBaseConfirmed && (
              <button
                type="button"
                onClick={() => setPlannerBaseConfirmed(true)}
                disabled={!plannerFloor.trim() || !plannerWall.trim()}
                className="h-12 w-full rounded-2xl bg-indigo-600 text-[15px] font-bold text-white disabled:bg-[#d1d6db]"
              >
                부위별 추천 보기
              </button>
            )}
          </div>

          {/* 2~3단계: 부위별 설명 + 선택 칩 */}
          {plannerBaseConfirmed && (
            <div className="mt-4 space-y-3">
              <PlannerPartCard
                label="방문·문틀"
                reason={plannerAnalysis.door.reason}
                candidates={plannerAnalysis.door.candidates}
                selected={plannerPicks.door}
                onSelect={(p) => {
                  setPlannerPicks((prev) => ({ ...prev, door: p }));
                  setShowPlannerMockup(false);
                }}
              />
              <PlannerPartCard
                label="샷시"
                reason={plannerAnalysis.sash.reason}
                candidates={plannerAnalysis.sash.candidates}
                selected={plannerPicks.sash}
                onSelect={(p) => {
                  setPlannerPicks((prev) => ({ ...prev, sash: p }));
                  setShowPlannerMockup(false);
                }}
              />
              <PlannerPartCard
                label="싱크대 하부장 (상부장은 화이트로 고정)"
                reason={plannerAnalysis.sink.reason}
                candidates={plannerAnalysis.sink.candidates}
                selected={plannerPicks.sink}
                onSelect={(p) => {
                  setPlannerPicks((prev) => ({ ...prev, sink: p }));
                  setShowPlannerMockup(false);
                }}
              />

              {/* 추가 부위(선택) — 걸레받이·몰딩·붙박이장·신발장·중문·현관문·
                  장식장. 기본 3곳과 달리 안 골라도 "AI 가상 시공 결과 보기"를
                  누를 수 있다. */}
              <button
                type="button"
                onClick={() => setPlannerExtraOpen((v) => !v)}
                className="flex h-11 w-full items-center justify-between rounded-2xl bg-white px-4 text-[13.5px] font-bold text-[#4e5968]"
              >
                <span>
                  추가 부위 선택(선택사항)
                  {(["baseboard", "molding", "wardrobe", "shoe", "middleDoor", "frontDoor", "display"] as PlannerPartKey[]).filter(
                    (k) => plannerPicks[k]
                  ).length > 0 &&
                    ` · ${
                      (["baseboard", "molding", "wardrobe", "shoe", "middleDoor", "frontDoor", "display"] as PlannerPartKey[]).filter(
                        (k) => plannerPicks[k]
                      ).length
                    }곳 선택됨`}
                </span>
                <span className="text-[11px] text-[#8b95a1]">{plannerExtraOpen ? "접기 ▲" : "펼치기 ▼"}</span>
              </button>
              {plannerExtraOpen &&
                (["baseboard", "molding", "wardrobe", "shoe", "middleDoor", "frontDoor", "display"] as PlannerPartKey[]).map((key) => (
                  <PlannerPartCard
                    key={key}
                    label={PLANNER_PART_LABELS[key]}
                    reason={plannerAnalysis[key].reason}
                    candidates={plannerAnalysis[key].candidates}
                    selected={plannerPicks[key]}
                    onSelect={(p) => {
                      setPlannerPicks((prev) => ({ ...prev, [key]: p }));
                      setShowPlannerMockup(false);
                    }}
                  />
                ))}

              {/* 4단계: 배색 미리보기 */}
              <button
                type="button"
                onClick={() => setShowPlannerMockup(true)}
                disabled={!plannerReady}
                className="h-12 w-full rounded-2xl bg-indigo-600 text-[15px] font-bold text-white disabled:bg-[#d1d6db]"
              >
                {plannerReady ? "AI 가상 시공 결과 보기" : "3곳 모두 색을 골라주세요"}
              </button>

              {showPlannerMockup && plannerPicks.door && plannerPicks.sash && plannerPicks.sink && (
                <div className="space-y-3">
                  {(() => {
                    const pickedParts = (Object.keys(PLANNER_PART_LABELS) as PlannerPartKey[]).filter((k) => plannerPicks[k]);
                    const vcKey = pickedParts.includes(plannerVcPart) ? plannerVcPart : pickedParts[0];
                    const vcPick = vcKey ? plannerPicks[vcKey] : null;
                    return (
                      <>
                        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                          {pickedParts.map((part) => (
                            <button
                              key={part}
                              type="button"
                              onClick={() => setPlannerVcPart(part)}
                              className={`h-10 shrink-0 whitespace-nowrap rounded-xl px-3 text-[13px] font-bold transition-colors ${
                                vcKey === part ? "bg-indigo-600 text-white" : "bg-white text-[#4e5968]"
                              }`}
                            >
                              {PLANNER_PART_LABELS[part]}
                            </button>
                          ))}
                        </div>
                        {vcKey && vcPick && (
                          <VirtualConstructionView
                            key={vcKey}
                            pick={{ ...vcPick, ...inferMaterialTraits(vcPick) }}
                            partLabel={PLANNER_PART_LABELS[vcKey]}
                          />
                        )}
                      </>
                    );
                  })()}
                  {/* 스마트 견적서는 바로 아래 "3. 스마트 자동 견적 계산기" 섹션이
                      전체 합계를 보여주므로, VirtualConstructionView 안에서는
                      중복해 보여주지 않는다(quoteTotal prop은 단독 사용 시를
                      위해 남겨 둔다). */}

                  {/* 2. 선택 자재 요약 영수증 — 기본 3곳은 항상, 추가 부위는 고른 것만 보여준다. */}
                  <div className="rounded-2xl bg-[#f8f9fa] p-4">
                    <p className="text-[12.5px] font-bold text-indigo-600">선택 자재 요약</p>
                    <div className="mt-2 divide-y divide-[#e5e8eb] rounded-xl bg-white">
                      {[
                        { label: "벽지", value: plannerWall.trim() || "미입력" },
                        { label: "바닥", value: plannerFloor.trim() || "미입력" },
                        { label: "방문", value: `${plannerPicks.door.brand} ${plannerPicks.door.code} (${plannerPicks.door.name})` },
                        { label: "샷시", value: `${plannerPicks.sash.brand} ${plannerPicks.sash.code} (${plannerPicks.sash.name})` },
                        { label: "싱크대 하부장", value: `${plannerPicks.sink.brand} ${plannerPicks.sink.code} (${plannerPicks.sink.name}) · 상부장 화이트 고정` },
                        ...(["baseboard", "molding", "wardrobe", "shoe", "middleDoor", "frontDoor", "display"] as PlannerPartKey[])
                          .filter((k) => plannerPicks[k])
                          .map((k) => {
                            const p = plannerPicks[k]!;
                            return { label: PLANNER_PART_LABELS[k], value: `${p.brand} ${p.code} (${p.name})` };
                          }),
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <span className="shrink-0 text-[12.5px] font-bold text-[#8b95a1]">{row.label}</span>
                          <span className="truncate text-right text-[13px] font-semibold text-[#191f28]">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 3. 스마트 자동 견적 계산기 — 숫자는 estimator_app 실제 단가표에서만 가져온다. */}
                  <div className="rounded-2xl bg-indigo-600 p-5 text-white">
                    <p className="text-[12.5px] font-bold text-indigo-200">예상 견적 (선택한 부위 기준)</p>
                    {plannerQuote ? (
                      <>
                        <p className="mt-1 text-[30px] font-extrabold tracking-tight">
                          {plannerQuoteTotal.toLocaleString("ko-KR")}원
                        </p>
                        <div className="mt-2 space-y-0.5 text-[12px] text-indigo-100">
                          <p>방문(도어 리폼 세트) {plannerQuote.door.price.toLocaleString("ko-KR")}원</p>
                          <p>샷시(방창 리폼 세트) {plannerQuote.sash.price.toLocaleString("ko-KR")}원</p>
                          <p>싱크대(ㄱ자 리폼 세트) {plannerQuote.sink.price.toLocaleString("ko-KR")}원</p>
                          {plannerQuote.extraLines.map((item) => (
                            <p key={item.label}>
                              {item.label} {item.price.toLocaleString("ko-KR")}원
                            </p>
                          ))}
                        </div>
                        {plannerQuote.uncounted.length > 0 && (
                          <p className="mt-1.5 text-[11px] text-indigo-200">
                            {plannerQuote.uncounted.map((k) => PLANNER_PART_LABELS[k]).join("·")}은 규격이 현장마다 달라 현장 확인 후
                            별도 산정합니다(위 금액에 포함되지 않음).
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-1 text-[14px] text-indigo-100">단가를 불러오는 중입니다…</p>
                    )}
                    <p className="mt-3 text-[11.5px] leading-relaxed text-indigo-100">
                      본 견적은 예상가이며, 현장 상태에 따라 변동될 수 있습니다. (1년 무상 A/S 포함)
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mt-5 rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(25,31,40,0.04)]">
          <h2 className="text-[16px] font-bold">자재로 상담하기</h2>
          <p className="mt-1 text-[13px] text-[#5b6573]">
            고객이 말한 자재를 그대로 적으면, 그 자재의 특성과 어울리는 이유까지 짚어줍니다.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={materialQuery}
              onChange={(e) => setMaterialQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleMaterialAnalyze()}
              placeholder="예: 벽지는 디아망으로, 바닥은 블랙 마루로 할 거예요"
              className="h-12 min-w-0 flex-1 rounded-2xl border border-[#e5e8eb] bg-[#f8f9fa] px-4 text-[15px] outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleMaterialAnalyze}
              aria-label="자재 분석"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white active:scale-95"
            >
              <Search className="h-5 w-5" strokeWidth={2.25} />
            </button>
          </div>

          {materialMatches && materialMatches.length === 0 && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-800">
              아직 아는 자재가 아니에요. 디아망·블랙마루·화이트마루·오크마루·노출콘크리트
              같은 이름으로 다시 적어 주시거나, 위 "맞춤 추천"에서 분위기로 골라 보세요.
            </p>
          )}

          {materialMatches && materialMatches.length > 0 && (
            <div className="mt-3 space-y-3">
              {materialMatches.map((m) => (
                <div key={m.keywords[0]} className="rounded-2xl bg-[#f8f9fa] p-4">
                  <p className="text-[12.5px] font-bold text-indigo-600">{m.kind} 특성</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-[#191f28]">{m.trait}</p>
                  <p className="mt-3 text-[12.5px] font-bold text-indigo-600">왜 이 필름인지</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-[#191f28]">{m.logic}</p>
                  <p className="mt-3 text-[12.5px] font-bold text-indigo-600">추천 품번</p>
                  <p className="mt-1 text-[13.5px] font-semibold leading-relaxed text-[#191f28]">{m.recommendLine}</p>
                  <div className="mt-2 flex gap-2">
                    {m.picks.slice(0, 4).map((p) => (
                      <div key={`${p.brand}-${p.code}`} className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5">
                        <span className="h-4 w-4 shrink-0 rounded-full border border-black/5" style={{ backgroundColor: p.approxHex }} />
                        <span className="whitespace-nowrap text-[11px] font-bold">{p.brand} {p.code}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-5 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="예: 따뜻한 색, 차가운 느낌, 나무 느낌…"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-[#e5e8eb] bg-white px-4 text-[15px] outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handleSearch}
            aria-label="색상 찾기"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white active:scale-95"
          >
            <Search className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>

        {answer === "none" && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-800">
            무슨 느낌인지 못 알아들었어요. "따뜻한", "차가운", "나무", "무난한" 같은
            말로 다시 말해 주시거나, 아래 칩을 눌러 직접 골라 보세요.
          </p>
        )}
        {answer && answer !== "none" && (
          <div className="mt-3 rounded-2xl bg-indigo-600 px-4 py-4 text-white">
            <p className="text-[14px] leading-relaxed">
              <b>"{query}"</b>이시면 <b>현대보닥</b> 중에서 이런 색이 잘 맞아요
            </p>
            <div className="mt-3 flex gap-3">
              {bodaqPicks.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setOpened(s)}
                  className="flex-1 overflow-hidden rounded-xl bg-white text-left text-[#191f28] active:scale-95"
                >
                  {swatchPhotos[s.id] ? (
                    <AssetImage src={swatchPhotos[s.id]} alt={s.name} className="h-12 w-full object-cover" />
                  ) : (
                    <div className="h-12 w-full" style={{ backgroundColor: s.colorHex }} />
                  )}
                  <div className="px-2 py-1.5">
                    <p className="truncate text-[12px] font-bold leading-tight">{s.name}</p>
                    <p className="text-[11px] text-[#8b95a1]">{s.code}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {TONE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setTone(f.key);
                setAnswer(null);
              }}
              className={`h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-[14px] font-bold transition-colors ${
                tone === f.key ? "bg-indigo-600 text-white" : "bg-white text-[#4e5968]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-6">
          {groups.map((group) => (
            <section key={group.label}>
              <p className="mb-2.5 px-1 text-[12.5px] font-bold uppercase tracking-wide text-[#8b95a1]">
                {group.label}
              </p>
              <div className="grid grid-cols-3 gap-3">
                {group.items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setOpened(s)}
                    className="overflow-hidden rounded-2xl bg-white text-left shadow-[0_1px_2px_rgba(25,31,40,0.04)] transition-transform active:scale-95"
                  >
                    {swatchPhotos[s.id] ? (
                      <AssetImage src={swatchPhotos[s.id]} alt={s.name} className="h-16 w-full object-cover" />
                    ) : (
                      <div className="h-16 w-full" style={{ backgroundColor: s.colorHex }} />
                    )}
                    <div className="px-2.5 py-2">
                      <p className="truncate text-[12.5px] font-bold leading-tight">{s.name}</p>
                      {s.code && <p className="mt-0.5 text-[11px] text-[#8b95a1]">{s.code}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-[14px] text-[#8b95a1]">해당 느낌의 색상이 아직 없습니다</p>
          )}
        </div>

        {scannedByBrand.length > 0 && (
          <div className="mt-8 space-y-6">
            <p className="px-1 text-[13px] font-bold text-[#191f28]">
              실물 견본 책자 스캔 ({scannedEntries.length}개 — /admin/swatch-scan에서 계속 추가됩니다)
            </p>
            {scannedByBrand.map(([brandName, list]) => (
              <section key={brandName}>
                <p className="mb-2.5 px-1 text-[12.5px] font-bold uppercase tracking-wide text-[#8b95a1]">
                  {brandName} ({list.length})
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {list.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setOpenedScan(e)}
                      className={`overflow-hidden rounded-2xl bg-white text-left shadow-[0_1px_2px_rgba(25,31,40,0.04)] transition-transform active:scale-95 ${
                        e.status === "needs_review" ? "opacity-60" : ""
                      }`}
                    >
                      <AssetImage src={swatchScanPhotoUrl(e.photo)} alt={e.name || e.code} className="h-16 w-full object-cover" />
                      <div className="px-2.5 py-2">
                        <p className="truncate text-[12.5px] font-bold leading-tight">{e.name || "(이름 확인 필요)"}</p>
                        <p className="mt-0.5 text-[11px] text-[#8b95a1]">{e.code || "코드 확인 필요"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {opened && <SwatchDetail swatch={opened} photoUrl={swatchPhotos[opened.id]} onClose={() => setOpened(null)} />}

      {openedScan && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/40 p-4" onClick={() => setOpenedScan(null)}>
          <div
            className="mt-auto w-full overflow-hidden rounded-[28px] bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <AssetImage
              src={swatchScanPhotoUrl(openedScan.photo)}
              alt={openedScan.name || openedScan.code}
              className="h-[46vh] w-full object-cover"
            />
            <div className="flex items-start justify-between gap-3 p-6">
              <div>
                <p className="text-[20px] font-extrabold tracking-tight text-[#191f28]">
                  {openedScan.name || "(이름 확인 필요)"}
                </p>
                <p className="mt-1 text-[13px] text-[#5b6573]">
                  {openedScan.brand} · {openedScan.code || "코드 확인 필요"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenedScan(null)}
                aria-label="닫기"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f2f4f6] text-[#4e5968]"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
