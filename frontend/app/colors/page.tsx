"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, X } from "lucide-react";
import { ALL_PATTERN_SWATCHES, TONE_LABELS } from "@/lib/patternSwatches";
import { useSwipeNavigate } from "@/lib/useSwipeNavigate";
import type { PatternSwatch } from "@/types";

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
  kind: "벽지" | "바닥" | "문" | "공간";
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
    keywords: ["페인트 질감", "페인트톤", "무몰딩", "히든도어"],
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
];

function findMaterials(query: string): MaterialKnowledge[] {
  const normalized = query.replace(/\s/g, "");
  return MATERIAL_KB.filter((m) => m.keywords.some((k) => normalized.includes(k.replace(/\s/g, ""))));
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
 *  보여줘야 고객이 실제로 어떤 느낌인지 가늠할 수 있다. */
function SwatchDetail({ swatch, onClose }: { swatch: PatternSwatch; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 p-4" onClick={onClose}>
      <div
        className="mt-auto w-full overflow-hidden rounded-[28px] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[46vh] w-full" style={{ backgroundColor: swatch.colorHex }} />
        <div className="flex items-start justify-between gap-3 p-6">
          <div>
            <p className="text-[20px] font-extrabold tracking-tight text-[#191f28]">{swatch.name}</p>
            <p className="mt-1 text-[13px] text-[#5b6573]">
              {swatch.brand ? `${swatch.brand}${swatch.code ? ` · ${swatch.code}` : ""}` : "기본 색상"}
              {" · "}
              {TONE_LABELS[swatch.tone]}
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

export default function ColorsPage() {
  const [tone, setTone] = useState<PatternSwatch["tone"] | "all">("all");
  const [opened, setOpened] = useState<PatternSwatch | null>(null);
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

  const swipe = useSwipeNavigate("/colors", !opened);

  return (
    <main
      className="min-h-screen min-h-[100dvh] bg-[#f2f4f6] text-[#191f28]"
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
    >
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
                  <div className="h-12 w-full" style={{ backgroundColor: s.colorHex }} />
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
                    <div className="h-16 w-full" style={{ backgroundColor: s.colorHex }} />
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
      </div>

      {opened && <SwatchDetail swatch={opened} onClose={() => setOpened(null)} />}
    </main>
  );
}
