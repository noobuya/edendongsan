import type { PatternSwatch } from "@/types";

// id/color_hex는 backend/app/catalog.py의 PATTERNS 와 반드시 동일하게 유지한다.
export const PATTERN_SWATCHES: PatternSwatch[] = [
  { id: "matte-white", name: "매트 화이트", colorHex: "#F2F1ED" },
  { id: "cream-white", name: "크림 화이트", colorHex: "#F5EEDC" },
  { id: "light-gray", name: "라이트 그레이", colorHex: "#C7CBCE" },
  { id: "dark-gray", name: "다크 그레이", colorHex: "#55585C" },
  { id: "matte-black", name: "매트 블랙", colorHex: "#2B2B2E" },
  { id: "oak-wood", name: "오크 우드", colorHex: "#B08B5A" },
  { id: "walnut-wood", name: "월넛 우드", colorHex: "#5C3A28" },
  { id: "deep-navy", name: "딥 네이비", colorHex: "#1F2A44" },
  { id: "olive-green", name: "올리브 그린", colorHex: "#6B6B3A" },
  { id: "warm-beige", name: "웜 베이지", colorHex: "#D9C7AC" },
];

// [현대보닥(BODAQ) 실제 샘플 카탈로그]
// 위 10개는 "매트 화이트"처럼 일반명뿐이라 실제 발주할 때 어느 제품인지 알 수 없었다.
// 여기부터는 현대L&C 보닥(bodaq.com) 공식 카탈로그의 실제 제품코드·컬러명을 그대로
// 쓴다 — 화면에서 고른 색을 그대로 자재 발주서에 옮길 수 있어야 한다. id·color_hex는
// backend/app/catalog.py의 PATTERNS와 반드시 동일하게 유지한다(색상 hex는 공식
// 사이트가 값을 공개하지 않아 컬러명을 보고 근사치로 잡은 값 — 화면 스와치용이고,
// 실제 AI 렌더링은 백엔드의 prompt_keyword가 정확한 톤을 결정한다).
export const BODAQ_SWATCHES: PatternSwatch[] = [
  { id: "bodaq-s261", name: "딥 슬레이트", colorHex: "#3A4048", brand: "현대보닥(BODAQ)", code: "S261" },
  { id: "bodaq-s262", name: "애시 그레이", colorHex: "#A9A9A2", brand: "현대보닥(BODAQ)", code: "S262" },
  { id: "bodaq-s263", name: "실버 미스트", colorHex: "#C9CCCE", brand: "현대보닥(BODAQ)", code: "S263" },
  { id: "bodaq-s264", name: "페블 그레이", colorHex: "#B9B4AC", brand: "현대보닥(BODAQ)", code: "S264" },
  { id: "bodaq-s265", name: "옵시디언 블루", colorHex: "#1C2430", brand: "현대보닥(BODAQ)", code: "S265" },
  { id: "bodaq-s266", name: "딥 포레스트", colorHex: "#21382C", brand: "현대보닥(BODAQ)", code: "S266" },
  { id: "bodaq-blc05", name: "퓨어 화이트", colorHex: "#FAFAF7", brand: "현대보닥(BODAQ)", code: "BLC05" },
  { id: "bodaq-smt02", name: "웜 에크루", colorHex: "#DCCBA8", brand: "현대보닥(BODAQ)", code: "SMT02" },
  { id: "bodaq-smt04", name: "드라이드 세이지", colorHex: "#8C9575", brand: "현대보닥(BODAQ)", code: "SMT04" },
  { id: "bodaq-w015", name: "헤리티지 골든 오크", colorHex: "#B98A4E", brand: "현대보닥(BODAQ)", code: "W015" },
  { id: "bodaq-w141", name: "리치 월넛", colorHex: "#4A2F22", brand: "현대보닥(BODAQ)", code: "W141" },
  { id: "bodaq-w883", name: "에스프레소 로스트 오크", colorHex: "#3B2A20", brand: "현대보닥(BODAQ)", code: "W883" },
  { id: "bodaq-w956", name: "드리프트우드 오크", colorHex: "#B8A891", brand: "현대보닥(BODAQ)", code: "W956" },
  { id: "bodaq-w011", name: "화이트워시드 오크", colorHex: "#E4DBC9", brand: "현대보닥(BODAQ)", code: "W011" },
];

/** SwatchPicker에 그대로 넘기면 "기본 색상" 다음에 "현대보닥(BODAQ)"이 이어지는
 *  전체 목록 — 브랜드 구분이 필요한 화면(견적서 패턴 선택 등)에서 쓴다. */
export const ALL_PATTERN_SWATCHES: PatternSwatch[] = [...PATTERN_SWATCHES, ...BODAQ_SWATCHES];
