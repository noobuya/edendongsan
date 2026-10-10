import type { MaskShape } from "@/lib/maskShapes";

export type JobStatus = "queued" | "processing" | "done" | "failed";

export type WorkItemId =
  | "film"
  | "sash"
  | "glass"
  | "lighting"
  | "fan"
  | "sink"
  | "door_frame"
  | "mesh_screen"
  | "toilet"
  | "wardrobe"
  | "wall_film"
  | "illustration";
export type GlassWorkType = "tint";
export type GlassTintType = "clear" | "frosted" | "mirror" | "blackout";
export type CeilingMaterial = "gypsum" | "concrete" | "wood_reinforced";
export type LightingInch = "3" | "4" | "5";
export type MeshType = "fine_20" | "ultra_30" | "pet_proof";
export type ToiletSpec = "standard" | "one_piece" | "bidet_combo";
export type SinkSpec = "standard_850" | "standard_860" | "premium_square";
export type FaucetType = "none" | "waterfall" | "gooseneck";
export type DrainType = "stainless_basic";
export type DetailCategory = "material" | "labor" | "expense";

/** 문짝 구조 타입 — 민짜문(통판) / 알판·격자문(세로 기둥+가로대+알판으로 분할 시공,
 *  홈 굴곡·덧방 때문에 훨씬 오래 걸림) / 타공문(유리를 끼우는 프레임만 시공).
 *  문짝이 아닌 항목(문틀·상하부장 등)에는 의미가 없어 기본값 "flat"으로 조용히 둔다. */
export type DoorType = "flat" | "lattice" | "glass";

export interface PanelItem {
  widthMm: number;
  heightMm: number;
  count: number;
  doorType?: DoorType;
}

export interface FilmOptions {
  patternId: string;
  unitPricePerM: number; // 원/m — 표준 장폭 1.22m 원단 기준
  needsPrimer: boolean;
  upperCabinets: PanelItem[];
  lowerCabinets: PanelItem[];
  islandTables: PanelItem[];
  doors: PanelItem[];
  doorframes: PanelItem[];
  moldingLengthM: number;
  fridgeCabinets: PanelItem[];
  pantryCabinets: PanelItem[];
  shoeCabinets: PanelItem[];
}

export interface SashOptions {
  patternId: string;
  unitPricePerM: number;
  needsPrimer: boolean;
  frames: PanelItem[];
  siliconeRecoat: boolean;
}

export type FireDoorSides = "single" | "double";

/** 현관 방화문 — 스틸 문이라 ㎡ 계산 없이 짝당 정액(단면/양면)으로 받는다. */
export interface FireDoorItem {
  sides: FireDoorSides;
  count: number;
}

/** 문짝·문틀 시공. 필름과 같은 원단·단가 체계를 쓰지만, 견적서에 문짝 금액이
 *  따로 나와야 고객에게 설명할 수 있어 별도 종목으로 둔다. */
export interface DoorFrameOptions {
  patternId: string;
  unitPricePerM: number;
  needsPrimer: boolean;
  doors: PanelItem[];
  doorframes: PanelItem[];
  fireDoors: FireDoorItem[];
  /** 기존 실리콘 제거 및 재시공 — 기본가 불포함, 선택 시에만 별도 청구. */
  siliconeRecoat: boolean;
}

/** 미세방충망 교체. 창 크기로 원단을 잡고, 틀까지 새로 짜면 짝당 비용이 더 붙는다. */
/** 장롱/옷장 필름. 문짝과 몸통을 나눠 받는다 — 품 기준이 두 배 가까이 다르다. */
/** 벽면 시트지. 벽지 위 시공이면 면처리가 거의 필수라 기본으로 켜 둔다. */
export interface WallFilmOptions {
  patternId: string;
  unitPricePerM: number;
  needsPrimer: boolean;
  walls: PanelItem[];
  siliconeRecoat: boolean;
}

export interface WardrobeOptions {
  patternId: string;
  unitPricePerM: number;
  needsPrimer: boolean;
  doors: PanelItem[];
  bodies: PanelItem[];
}

export interface MeshScreenOptions {
  meshType: MeshType;
  screens: PanelItem[];
  replaceFrame: boolean;
}

/** 변기 설치/교체 — 면적이 아니라 대수 기준이다. */
export interface ToiletOptions {
  spec: ToiletSpec;
  count: number;
  removeExisting: boolean;
  replaceSupplyLine: boolean;
}

export interface GlassOptions {
  workType: GlassWorkType;
  tintType: GlassTintType;
  panels: PanelItem[];
}

/** 사장님 전용 일러스트 항목. 학생 기기에서는 선택할 수 없다. */
export interface IllustrationOptions {
  count: number;
  text: string;
  description: string;
}

export interface LightingOptions {
  inch: LightingInch;
  lightCount: number;
  wiringExtensionM: number;
}

export interface FanOptions {
  fanCount: number;
  fanColor: string; // lib/patternSwatches.ts의 색상 id 재사용
  ceilingMaterial: CeilingMaterial;
  reinforcementAreaM2: number;
  ceilingHeightM: number;
}

export interface SinkOptions {
  spec: SinkSpec;
  faucetType: FaucetType;
  drainType: DrainType;
}

export interface JobOptionsState {
  film: FilmOptions;
  sash: SashOptions;
  glass: GlassOptions;
  lighting: LightingOptions;
  fan: FanOptions;
  sink: SinkOptions;
  door_frame: DoorFrameOptions;
  mesh_screen: MeshScreenOptions;
  toilet: ToiletOptions;
  wardrobe: WardrobeOptions;
  wall_film: WallFilmOptions;
  illustration: IllustrationOptions;
}

export interface CreateJobParams {
  photo: File;
  customerName: string;
  selectedItems: WorkItemId[];
  options: JobOptionsState;
  illustrationText: string;
  illustrationDescription: string;
  renderMode: RenderMode;
  autoDescription: string;
  manualRegions: MappedRegion[];
  /** 사장님 기기의 관리자 토큰. 일러스트 문구를 보낼 때 함께 보낸다. */
  ownerToken?: string | null;
}

export interface LineItemDetail {
  label: string;
  spec: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  category: DetailCategory;
  material_code: string;
}

/** 품번(패턴 id) 기준 자재 발주 집계 한 줄 — 사장님 전용(고객 비공개). */
export interface MaterialOrderLine {
  pattern_id: string;
  name: string;
  color_hex: string;
  total_length_m: number;
  order_length_m: number;
  item_names: string[];
}

export interface LineItem {
  item_id: WorkItemId;
  item_name: string;
  details: LineItemDetail[];
  subtotal: number;
}

export interface DepositInfo {
  rate_percent: number;
  amount: number;
  note: string;
}

/** 영업 리포트(ROI 비교) — sales_pitch(문장)와 같은 품목에서 뽑은 구조화된 숫자라
 *  막대그래프·소구포인트 칩이 문장과 항상 일치한다. */
export interface RoiComparison {
  item_name: string;
  replacement_cost: number;
  film_cost: number;
  savings_percent: number;
  days_replacement: number;
  days_film: number;
  highlights: string[];
}

export interface EstimateBreakdown {
  line_items: LineItem[];
  ceiling_area_m2: number;
  material_total: number;
  labor_total: number;
  expense_total: number;
  supply_amount: number;
  vat: number;
  total_cost: number;
  material_orders: MaterialOrderLine[];
  raw_supply_amount: number;
  min_callout_applied: boolean;
  min_callout_note: string;
  deposit: DepositInfo | null;
  sales_pitch: string;
  roi_comparison: RoiComparison | null;
}

export interface Region {
  id: string;
  label: string;
  category: string;
  bbox: [number, number, number, number];
  mask_url: string;
}

export type WorkPhotoStage = "before" | "progress" | "after";

export interface WorkPhoto {
  id: string;
  url: string;
  stage: WorkPhotoStage;
  caption: string;
  uploaded_at: string;
}

export interface BlogPost {
  title: string;
  content: string;
  created_at: string;
  /** 네이버 블로그 "1초 팩" 복사 버튼이 본문 끝에 붙이는 태그 목록. */
  hashtags: string[];
}

/** 견적 공유 커뮤니티 — 고객 이름·사진 없이 품목·단가·총액만 올라간다. */
export interface SharedEstimate {
  id: string;
  author: string;
  item_names: string[];
  line_items: LineItem[];
  total_cost: number;
  note: string;
  created: number;
}

/** 개인 작업 일지의 사진 한 장. */
export interface JournalPhoto {
  id: string;
  url: string;
  caption: string;
  uploaded_at: string;
}

/** 개인 작업 일지. 본인과 관리자만 조회·수정할 수 있다. */
export interface JournalEntry {
  id: string;
  owner: string;
  title: string;
  content: string;
  photos: JournalPhoto[];
  created: number;
  updated: number;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  /** 처리 중인 현재 단계("영역 인식 중" 등). 진행 표시이자, 폴링이 "멈춤"을
   *  판정하는 신호다 — 값이 바뀌는 동안은 오래 걸려도 실패로 보지 않는다. */
  stage?: string | null;
  rendered_image_url?: string;
  original_image_url?: string;
  mask_preview_url?: string;
  regions: Region[];
  estimate?: EstimateBreakdown;
  error?: string;
  /** 시공이 일부 적용되지 않았을 때의 안내 문구 목록. */
  notices?: string[];
  editing: boolean;
  editing_region_id?: string;
  edit_error?: string;
  customer_name: string;
  created_at?: string;
  work_photos: WorkPhoto[];
  blog_post?: BlogPost;
  signature?: Signature | null;
  site_conditions?: SiteConditions | null;
}

/** 현장에서 고객이 화면에 직접 그린 서명. */
export interface Signature {
  image: string;
  signed_at: string;
}

/** 시공 전 하지(바탕면) 점검 — 일본 3M 다이노크 시공 매뉴얼의 핵심 점검 항목. */
export interface SubstrateChecklist {
  dust_removed: boolean;
  no_unevenness: boolean;
  surface_dry: boolean;
  primer_applied: boolean;
  temperature_ok: boolean;
}

export interface SiteConditions {
  temperature_c: number | null;
  checklist: SubstrateChecklist;
  recorded_at: string;
}

export interface PatternSwatch {
  id: string;
  name: string;
  colorHex: string;
  /** 실제 제조사 브랜드(예: "BODAQ") — 있으면 선택 화면에서 이 브랜드끼리 묶어
   *  보여준다. 없으면(기본 색상 10종) 묶지 않고 그대로 보여준다. */
  brand?: string;
  /** 그 브랜드의 실제 제품 코드(예: "W015") — 발주할 때 그대로 참고할 수 있게
   *  화면에 코드까지 노출한다. */
  code?: string;
}

export interface QuoteSummary {
  job_id: string;
  customer_name: string;
  created_at: string;
  total_cost: number;
  thumbnail_url?: string;
  has_blog: boolean;
}

export interface BlogSummary {
  job_id: string;
  title: string;
  customer_name: string;
  created_at: string;
  cover_image_url?: string;
  excerpt: string;
}

export interface BlogDetail {
  job_id: string;
  title: string;
  content: string;
  customer_name: string;
  created_at: string;
  before_image_url?: string;
  after_image_url?: string;
  work_photos: WorkPhoto[];
  line_item_names: string[];
}

// ── AI 제안서(고객 발송용 상세페이지) — /blog와 분리된 비공개 공유 링크 ──
export type ProposalStatus = "review" | "published";

export interface Proposal {
  id: string;
  status: ProposalStatus;
  created_at: string;
  published_at: string | null;
  job_id: string | null;
  source_image_url: string;
  wide_image_url: string;
  detail_image_url: string;
  headline: string;
  body: string;
  // ── job_id가 있을 때만 생성 시점에 스냅샷으로 채워지는 "풀패키지" 자료 ──
  // 독립 생성(job_id 없음)이면 전부 null — 공유 페이지는 이 값들이 있을 때만
  // 비포/애프터 슬라이더·ROI 그래프·정밀 견적서·바탕면 점검 리포트를 보여준다.
  before_image_url: string | null;
  estimate: EstimateBreakdown | null;
  site_conditions: SiteConditions | null;
}

export type ProposalFeedbackTarget = "detail_image" | "copy";
export type ProposalFeedbackAction = "brighter" | "darker" | "shorter" | "longer" | "custom";

export interface ProposalPublic {
  id: string;
  created_at: string;
  wide_image_url: string;
  detail_image_url: string;
  headline: string;
  body: string;
  before_image_url: string | null;
  estimate: EstimateBreakdown | null;
  site_conditions: SiteConditions | null;
}

/** 서명 완료된 시공 건을 모아 보여주는 공개 쇼케이스 갤러리 한 칸.
 *  고객 이름·연락처·금액은 들어있지 않다(portfolio.py 참고). */
export interface PortfolioEntry {
  job_id: string;
  before_image_url: string | null;
  after_image_url: string | null;
  item_tags: string[];
  completed_at: string;
}

/** 수동 모드에서 사용자가 직접 칠해 만든 시공 영역 한 개.
 *  캔버스에서 칠한 마스크와 그 자리에 시공할 자재가 한 세트로 묶인다. */
export interface MappedRegion {
  id: number;
  /** 흰색 = 시공 영역인 PNG 데이터 URL (원본 사진과 같은 해상도) */
  maskDataUrl: string;
  /** 이 영역을 만든 벡터 도형들. 마스크는 여기서 구워지며, 화면에도 이 도형을
   *  그대로 다시 그린다 — 픽셀 마스크를 되읽어 색을 입히는 것보다 훨씬 빠르고
   *  경계도 원본 그대로 선명하다. */
  shapes: MaskShape[];
  category: WorkItemId;
  option: string;
  optionLabel: string;
  /** 표면 마감 변경인지, 없던 물건 생성인지 — 백엔드가 렌더링 방식을 가른다. */
  taskType: "surface_change" | "object_creation";
  /** 이 영역에 무엇을 시공할지 서술한 프롬프트 (백엔드에서 마스터 프롬프트와 합성) */
  prompt: string;
  /** 이 구역에 넣을 문구나 그림 — 예: "중앙에 'Cafe 1984' 텍스트 추가".
   *  카페·식당 시공에서 상호와 로고를 시트지·썬팅 위에 올릴 때 쓴다. */
  customDesign?: string;
  /** door_frame(문짝/문틀) 시공에서만 의미 있음 — 원래 문이 나무(합판) 문인지,
   *  현관문·방화문처럼 페인트칠한 스틸 문인지. AI 편집 지시문이 문 재질에 맞는
   *  문장을 쓰도록(나뭇결이 없는 문에 "나뭇결을 없애라"고 하지 않도록) 갈라 준다. */
  doorMaterial?: "wood" | "steel";
  /** 화면 표시용 색 인덱스 (REGION_COLORS) */
  colorIndex: number;
  /** 라벨을 띄울 위치 — 사진 크기 대비 0~1 비율 */
  labelAt: { x: number; y: number };
}

export type RenderMode = "auto" | "manual";

/** 단가 설정 화면의 항목 한 줄 (백엔드 app/pricing_store.py의 PRICING_FIELDS와 1:1). */
export interface PricingField {
  key: string;
  label: string;
  group: string;
  unit: string;
  value: number;
  default: number;
}
