import { Blinds, DoorOpen, Droplets, Fan, Grid2x2, Layers, Lightbulb, Rows3, Shirt, Sparkles, Toilet } from "lucide-react";
import type { JobOptionsState, WorkItemId } from "@/types";

/** 시공 항목 정의 한 곳. 항목 선택 시트, 항목 카드, 옵션 시트가 모두 여기를 본다. */
export const WORK_ITEM_META: Record<
  WorkItemId,
  { label: string; icon: typeof Layers; description: string }
> = {
  film: { label: "싱크대/상하부장", icon: Layers, description: "주방 상·하부장 필름 시공" },
  sash: { label: "샷시 필름", icon: Blinds, description: "창틀·문틀 필름 랩핑" },
  glass: { label: "유리 썬팅/일러스트", icon: Sparkles, description: "유리문 썬팅과 그래픽" },
  lighting: { label: "조명/다운라이트", icon: Lightbulb, description: "천장 조명 교체·추가" },
  fan: { label: "실링팬", icon: Fan, description: "실링팬 설치와 보강" },
  sink: { label: "싱크볼 교체", icon: Droplets, description: "싱크볼·수전 교체" },
  door_frame: { label: "문짝/문틀 시공", icon: DoorOpen, description: "방문·문틀 필름 랩핑" },
  mesh_screen: { label: "미세방충망", icon: Grid2x2, description: "창 방충망 원단·틀 교체" },
  toilet: { label: "변기 설치", icon: Toilet, description: "변기 교체·철거·급수 연결" },
  wardrobe: { label: "장롱/옷장", icon: Shirt, description: "옷장 문짝·몸통 필름 랩핑" },
  wall_film: { label: "벽면 시트지", icon: Rows3, description: "벽면 필름 시공·면처리" },
};

/** 시공 항목의 상위 묶음.
 *
 *  필름 계열은 쓰는 자재와 색 팔레트가 같고 부위만 다르다. 한 줄로 늘어놓으면
 *  "샷시도 필름인가?"부터 헷갈리므로, 고를 때는 큰 종목을 먼저 고르고 그 안에서
 *  부위를 정하게 한다. 견적 계산과 단가는 부위별로 그대로 따로 잡힌다 —
 *  품 산출 기준이 부위마다 다르기 때문이다. */
export interface WorkItemGroup {
  id: string;
  label: string;
  description: string;
  icon: typeof Layers;
  children: WorkItemId[];
}

export const WORK_ITEM_GROUPS: WorkItemGroup[] = [
  {
    id: "film_family",
    label: "인테리어 필름",
    description: "같은 필름 자재로 부위만 다르게 시공합니다",
    icon: Layers,
    children: ["film", "sash", "door_frame", "wardrobe", "wall_film"],
  },
  {
    id: "glass_family",
    label: "유리 썬팅/일러스트",
    description: "유리문 썬팅과 그래픽",
    icon: Sparkles,
    children: ["glass"],
  },
  {
    id: "ceiling_family",
    label: "천장 시공",
    description: "조명·실링팬",
    icon: Lightbulb,
    children: ["lighting", "fan"],
  },
  {
    id: "plumbing_family",
    label: "주방·욕실 설비",
    description: "싱크볼·변기 교체",
    icon: Droplets,
    children: ["sink", "toilet"],
  },
  {
    id: "window_family",
    label: "창호 부속",
    description: "미세방충망",
    icon: Grid2x2,
    children: ["mesh_screen"],
  },
];


export const DEFAULT_OPTIONS: JobOptionsState = {
  film: {
    patternId: "matte-white",
    unitPricePerM: 10_000,
    needsPrimer: false,
    upperCabinets: [],
    lowerCabinets: [],
    islandTables: [],
    doors: [],
    doorframes: [],
    moldingLengthM: 0,
    fridgeCabinets: [],
    pantryCabinets: [],
    shoeCabinets: [],
  },
  sash: { patternId: "matte-white", unitPricePerM: 10_000, needsPrimer: false, frames: [] },
  door_frame: {
    patternId: "matte-white",
    unitPricePerM: 10_000,
    needsPrimer: false,
    doors: [],
    doorframes: [],
  },
  glass: { workType: "tint", tintType: "frosted", panels: [], illustCount: 0 },
  // 개수 기본값은 0으로 둔다 — 사용자가 조명/실링팬 폼을 건드리지 않았는데도
  // 기본값(1대/4개)이 그대로 제출돼, 필름만 테스트하려던 사진에 실링팬·다운라이트
  // 아이콘이 뜬금없이 합성되는 문제가 있었다.
  lighting: { inch: "4", lightCount: 0, wiringExtensionM: 0 },
  fan: {
    fanCount: 0,
    fanColor: "matte-black",
    ceilingMaterial: "gypsum",
    reinforcementAreaM2: 0,
    ceilingHeightM: 2.4,
  },
  sink: { spec: "standard_850", faucetType: "none", drainType: "stainless_basic" },
  wardrobe: {
    patternId: "matte-white",
    unitPricePerM: 10_000,
    needsPrimer: false,
    doors: [],
    bodies: [],
  },
  wall_film: {
    patternId: "matte-white",
    unitPricePerM: 10_000,
    // 벽지 위에 그냥 붙이면 들뜬다 — 기본으로 켜 둔다.
    needsPrimer: true,
    walls: [],
  },
  mesh_screen: { meshType: "fine_20", screens: [], replaceFrame: false },
  // 개수 기본값은 0 — 건드리지도 않은 항목이 견적에 얹히면 안 된다.
  toilet: { spec: "standard", count: 0, removeExisting: true, replaceSupplyLine: true },
};

/** 전체 시공 항목. 목록을 따로 적지 않고 그룹에서 뽑아낸다 —
 *  따로 적어두면 새 항목을 그룹에만 넣고 목록에 빠뜨리거나, 순서가 그룹과 어긋나
 *  항목 카드에 같은 머리글("인테리어 필름")이 두 번 찍히는 일이 생긴다. */
export const ALL_WORK_ITEMS: WorkItemId[] = WORK_ITEM_GROUPS.flatMap((g) => g.children);

/** 처음 사진을 찍고 견적을 낼 때 기본으로 켜 둘 항목 — 지금 이 앱의 주 목적인
 *  "필름시공" 계열(film_family: 인테리어 필름·샷시·문짝/문틀·장롱옷장·벽면)만
 *  기본으로 보여준다. 조명·실링팬·싱크볼·변기·미세방충망·유리 썬팅처럼 필름과
 *  무관한 항목까지 처음부터 11개 다 떠 있으면, 방문 하나 찍고 견적 내려 했을
 *  뿐인데 관련 없는 항목들을 눈으로 걸러내야 했다 — 그 항목들이 필요한 현장이면
 *  화면 오른쪽 아래 + 버튼으로 그때그때 추가하면 된다(기능 자체는 그대로 있다). */
export const DEFAULT_WORK_ITEMS: WorkItemId[] =
  WORK_ITEM_GROUPS.find((g) => g.id === "film_family")?.children ?? ALL_WORK_ITEMS;

/** 시공 항목이 "이미 있는 표면의 마감을 바꾸는 일"인지, "없던 물건을 새로 만드는
 *  일"인지 구분한다. 백엔드 AI 파이프라인이 이 값으로 렌더링 방식을 완전히 다르게
 *  분기한다 — 표면은 원래 구조(손잡이·프레임)를 지켜야 하고, 물건은 새로 그려야 한다. */
export function taskTypeOf(item: WorkItemId): "surface_change" | "object_creation" {
  return item === "lighting" || item === "fan" || item === "sink" || item === "toilet"
    ? "object_creation"
    : "surface_change";
}

/** 현대보닥(BODAQ) 공식 카탈로그(bodaq.com)의 실제 제품코드·컬러명 — 화면에서 고른
 *  색을 그대로 자재 발주서에 옮길 수 있게 한다. id·colorHex는 backend/app/catalog.py의
 *  PATTERNS, frontend/lib/patternSwatches.ts의 BODAQ_SWATCHES와 반드시 동일하게
 *  유지한다. 여러 카테고리(문짝·인테리어필름·옷장·벽면)가 같은 목록을 그대로 쓰므로
 *  한 곳에 두고 스프레드해서 쓴다. */
const BODAQ_MATERIAL_OPTIONS: { id: string; label: string; colorHex: string; brand: string; code: string }[] = [
  { id: "bodaq-s261", label: "딥 슬레이트", colorHex: "#3A4048", brand: "현대보닥(BODAQ)", code: "S261" },
  { id: "bodaq-s262", label: "애시 그레이", colorHex: "#A9A9A2", brand: "현대보닥(BODAQ)", code: "S262" },
  { id: "bodaq-s263", label: "실버 미스트", colorHex: "#C9CCCE", brand: "현대보닥(BODAQ)", code: "S263" },
  { id: "bodaq-s264", label: "페블 그레이", colorHex: "#B9B4AC", brand: "현대보닥(BODAQ)", code: "S264" },
  { id: "bodaq-s265", label: "옵시디언 블루", colorHex: "#1C2430", brand: "현대보닥(BODAQ)", code: "S265" },
  { id: "bodaq-s266", label: "딥 포레스트", colorHex: "#21382C", brand: "현대보닥(BODAQ)", code: "S266" },
  { id: "bodaq-blc05", label: "퓨어 화이트", colorHex: "#FAFAF7", brand: "현대보닥(BODAQ)", code: "BLC05" },
  { id: "bodaq-smt02", label: "웜 에크루", colorHex: "#DCCBA8", brand: "현대보닥(BODAQ)", code: "SMT02" },
  { id: "bodaq-smt04", label: "드라이드 세이지", colorHex: "#8C9575", brand: "현대보닥(BODAQ)", code: "SMT04" },
  { id: "bodaq-w015", label: "헤리티지 골든 오크", colorHex: "#B98A4E", brand: "현대보닥(BODAQ)", code: "W015" },
  { id: "bodaq-w141", label: "리치 월넛", colorHex: "#4A2F22", brand: "현대보닥(BODAQ)", code: "W141" },
  { id: "bodaq-w883", label: "에스프레소 로스트 오크", colorHex: "#3B2A20", brand: "현대보닥(BODAQ)", code: "W883" },
  { id: "bodaq-w956", label: "드리프트우드 오크", colorHex: "#B8A891", brand: "현대보닥(BODAQ)", code: "W956" },
  { id: "bodaq-w011", label: "화이트워시드 오크", colorHex: "#E4DBC9", brand: "현대보닥(BODAQ)", code: "W011" },
];
// 창틀(sash)은 나뭇결보다 솔리드 컬러가 압도적으로 많이 쓰여, 우드 톤은 빼고
// 솔리드 계열만 골라 쓴다.
const BODAQ_SOLID_ONLY = BODAQ_MATERIAL_OPTIONS.filter((o) => !o.id.startsWith("bodaq-w"));

/** 수동 매핑에서 "칠한 영역에 무엇을 시공할지" 고를 때 쓰는 자재 목록.
 *  견적 폼의 옵션 id와 같은 값을 써서 백엔드가 그대로 알아듣게 한다. */
export const MATERIAL_OPTIONS: Record<
  WorkItemId,
  { id: string; label: string; colorHex?: string; brand?: string; code?: string }[]
> = {
  film: [
    { id: "matte-white", label: "매트 화이트", colorHex: "#F2F1ED" },
    { id: "cream-white", label: "크림 화이트", colorHex: "#F5EEDC" },
    { id: "light-gray", label: "라이트 그레이", colorHex: "#C7CBCE" },
    { id: "dark-gray", label: "다크 그레이", colorHex: "#55585C" },
    { id: "matte-black", label: "매트 블랙", colorHex: "#2B2B2E" },
    { id: "oak-wood", label: "오크 우드", colorHex: "#B08B5A" },
    { id: "walnut-wood", label: "월넛 우드", colorHex: "#5C3A28" },
    { id: "deep-navy", label: "딥 네이비", colorHex: "#1F2A44" },
    ...BODAQ_MATERIAL_OPTIONS,
  ],
  sash: [
    { id: "matte-white", label: "화이트 샷시", colorHex: "#F2F1ED" },
    { id: "matte-black", label: "블랙 샷시", colorHex: "#2B2B2E" },
    { id: "dark-gray", label: "그레이 샷시", colorHex: "#55585C" },
    ...BODAQ_SOLID_ONLY,
  ],
  glass: [
    { id: "clear", label: "투명 썬팅" },
    { id: "frosted", label: "반투명 썬팅" },
    { id: "mirror", label: "미러 썬팅" },
    { id: "blackout", label: "블랙아웃" },
  ],
  lighting: [
    { id: "downlight_4", label: "4인치 다운라이트" },
    { id: "downlight_6", label: "6인치 다운라이트" },
  ],
  fan: [
    { id: "ceiling_fan_black", label: "실링팬 (블랙)" },
    { id: "ceiling_fan_white", label: "실링팬 (화이트)" },
    { id: "ceiling_fan_wood", label: "실링팬 (우드)" },
  ],
  door_frame: [
    { id: "matte-white", label: "매트 화이트", colorHex: "#F2F1ED" },
    { id: "matte-black", label: "매트 블랙", colorHex: "#2B2B2E" },
    { id: "oak-wood", label: "오크 우드", colorHex: "#B08B5A" },
    { id: "walnut-wood", label: "월넛 우드", colorHex: "#5C3A28" },
    ...BODAQ_MATERIAL_OPTIONS,
  ],
  sink: [
    { id: "standard_850", label: "스탠다드 850" },
    { id: "wide_1200", label: "와이드 1200" },
  ],
  wardrobe: [
    { id: "matte-white", label: "매트 화이트", colorHex: "#F2F1ED" },
    { id: "cream-white", label: "크림 화이트", colorHex: "#F5EEDC" },
    { id: "matte-black", label: "매트 블랙", colorHex: "#2B2B2E" },
    { id: "oak-wood", label: "오크 우드", colorHex: "#B08B5A" },
    { id: "walnut-wood", label: "월넛 우드", colorHex: "#5C3A28" },
    ...BODAQ_MATERIAL_OPTIONS,
  ],
  wall_film: [
    { id: "matte-white", label: "매트 화이트", colorHex: "#F2F1ED" },
    { id: "cream-white", label: "크림 화이트", colorHex: "#F5EEDC" },
    { id: "light-gray", label: "라이트 그레이", colorHex: "#C7CBCE" },
    { id: "warm-beige", label: "웜 베이지", colorHex: "#D9C7A7" },
    { id: "oak-wood", label: "오크 우드", colorHex: "#B08B5A" },
    ...BODAQ_MATERIAL_OPTIONS,
  ],
  mesh_screen: [
    { id: "fine_20", label: "미세 (20메시)" },
    { id: "ultra_30", label: "초미세 (30메시)" },
    { id: "pet_proof", label: "펫 방충망" },
  ],
  toilet: [
    { id: "standard", label: "일반형 변기" },
    { id: "one_piece", label: "원피스 변기" },
    { id: "bidet_combo", label: "비데 일체형" },
  ],
};

/** door_frame(문짝/문틀)에서만 보여주는 "문 종류" 선택지 — 원래 문이 나무 문인지,
 *  현관문·방화문처럼 페인트칠한 스틸 문인지. 현관문·방화문은 한국 아파트에서 거의
 *  같은 구조(방화 등급 스틸 문)라 메뉴는 둘 다 보여주되 백엔드로는 같은 material
 *  값("steel")을 보낸다 — AI 편집 지시문이 "나뭇결을 없애라"처럼 없는 걸 없애라는
 *  모순된 말을 하지 않도록 갈라 주는 게 목적이라, 이름이 달라도 처리는 같다.
 *  (id는 화면에서 "지금 고른 게 어느 칩인지" 구분하는 용도라 material과 별개로 둔다 —
 *  안 그러면 현관문·방화문이 같은 material이라 둘 다 동시에 활성화된 것처럼 보인다.) */
export const DOOR_MATERIAL_OPTIONS: { id: string; label: string; material: "wood" | "steel" }[] = [
  { id: "wood", label: "방문 (나무)", material: "wood" },
  { id: "entrance", label: "현관문", material: "steel" },
  { id: "fire", label: "방화문", material: "steel" },
];

/** 매핑한 영역을 서로 구분해 보여주는 색. 순서대로 돌려 쓴다. */
export const REGION_COLORS = [
  { name: "블루", stroke: "#2563eb", fill: "rgba(37, 99, 235, 0.38)" },
  { name: "옐로", stroke: "#d97706", fill: "rgba(245, 158, 11, 0.38)" },
  { name: "그린", stroke: "#059669", fill: "rgba(16, 185, 129, 0.38)" },
  { name: "핑크", stroke: "#db2777", fill: "rgba(236, 72, 153, 0.38)" },
  { name: "퍼플", stroke: "#7c3aed", fill: "rgba(139, 92, 246, 0.38)" },
  { name: "시안", stroke: "#0891b2", fill: "rgba(6, 182, 212, 0.38)" },
];

/** 항목 카드에 "무엇을 입력했는지" 한 줄로 요약해 보여준다 — 카드를 열지 않고도
 *  빠진 항목을 알아볼 수 있어야 상담 중에 되돌아가는 일이 줄어든다. */
export function summarizeItem(item: WorkItemId, options: JobOptionsState): string {
  const panelCount = (list: { count: number }[]) => list.reduce((sum, p) => sum + (p.count || 0), 0);

  if (item === "film") {
    const f = options.film;
    const total =
      panelCount(f.upperCabinets) +
      panelCount(f.lowerCabinets) +
      panelCount(f.islandTables) +
      panelCount(f.doors) +
      panelCount(f.doorframes) +
      panelCount(f.fridgeCabinets) +
      panelCount(f.pantryCabinets) +
      panelCount(f.shoeCabinets);
    return total > 0 ? `${total}개 부위 · 몰딩 ${f.moldingLengthM}m` : "부위를 입력해주세요";
  }
  if (item === "wall_film") {
    const count = panelCount(options.wall_film.walls);
    return count > 0 ? `벽면 ${count}곳` : "벽 크기를 입력해주세요";
  }
  if (item === "wardrobe") {
    const w = options.wardrobe;
    const doors = panelCount(w.doors);
    const bodies = panelCount(w.bodies);
    return doors + bodies > 0 ? `문짝 ${doors}짝 · 몸통 ${bodies}개` : "옷장 규격을 입력해주세요";
  }
  if (item === "mesh_screen") {
    const count = panelCount(options.mesh_screen.screens);
    return count > 0 ? `창 ${count}짝${options.mesh_screen.replaceFrame ? " · 틀 교체" : ""}` : "창 규격을 입력해주세요";
  }
  if (item === "toilet") {
    return options.toilet.count > 0 ? `변기 ${options.toilet.count}대` : "대수를 입력해주세요";
  }
  if (item === "door_frame") {
    const d = options.door_frame;
    const doors = panelCount(d.doors);
    const frames = panelCount(d.doorframes);
    return doors + frames > 0 ? `문짝 ${doors}짝 · 문틀 ${frames}개` : "문짝·문틀 규격을 입력해주세요";
  }
  if (item === "sash") {
    const count = panelCount(options.sash.frames);
    return count > 0 ? `창틀 ${count}개` : "창틀 크기를 입력해주세요";
  }
  if (item === "glass") {
    const g = options.glass;
    const labels: Record<string, string> = { tint: "썬팅", illust: "일러스트", both: "썬팅+일러스트" };
    const panels = panelCount(g.panels);
    return `${labels[g.workType]} · 유리 ${panels}장${g.illustCount ? ` · 그래픽 ${g.illustCount}건` : ""}`;
  }
  if (item === "lighting") {
    const l = options.lighting;
    return l.lightCount > 0 ? `${l.inch}인치 ${l.lightCount}개` : "조명 개수를 입력해주세요";
  }
  if (item === "fan") {
    return options.fan.fanCount > 0 ? `실링팬 ${options.fan.fanCount}대` : "대수를 입력해주세요";
  }
  return "규격 선택됨";
}
