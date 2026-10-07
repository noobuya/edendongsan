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
export type GlassWorkType = "tint" | "illust" | "both";
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
}

/** 문짝·문틀 시공. 필름과 같은 원단·단가 체계를 쓰지만, 견적서에 문짝 금액이
 *  따로 나와야 고객에게 설명할 수 있어 별도 종목으로 둔다. */
export interface DoorFrameOptions {
  patternId: string;
  unitPricePerM: number;
  needsPrimer: boolean;
  doors: PanelItem[];
  doorframes: PanelItem[];
}

/** 미세방충망 교체. 창 크기로 원단을 잡고, 틀까지 새로 짜면 짝당 비용이 더 붙는다. */
/** 장롱/옷장 필름. 문짝과 몸통을 나눠 받는다 — 품 기준이 두 배 가까이 다르다. */
/** 벽면 시트지. 벽지 위 시공이면 면처리가 거의 필수라 기본으로 켜 둔다. */
export interface WallFilmOptions {
  patternId: string;
  unitPricePerM: number;
  needsPrimer: boolean;
  walls: PanelItem[];
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
  illustCount: number;
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
  /** 수강생 승인 코드. 사장님 기기가 아니면 견적을 만들 때 반드시 필요하다. */
  accessCode?: string | null;
}

export interface LineItemDetail {
  label: string;
  spec: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  category: DetailCategory;
}

export interface LineItem {
  item_id: WorkItemId;
  item_name: string;
  details: LineItemDetail[];
  subtotal: number;
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
