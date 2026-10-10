from typing import Literal, Optional

from pydantic import BaseModel, Field

WorkItemId = Literal[
    "film", "sash", "glass", "lighting", "fan", "sink", "door_frame", "mesh_screen", "toilet", "wardrobe", "wall_film",
    "illustration",
]
MeshType = Literal["fine_20", "ultra_30", "pet_proof"]
ToiletSpec = Literal["standard", "one_piece", "bidet_combo"]
GlassWorkType = Literal["tint"]
GlassTintType = Literal["clear", "frosted", "mirror", "blackout"]
CeilingMaterial = Literal["gypsum", "concrete", "wood_reinforced"]
LightingInch = Literal["3", "4", "5"]
SinkSpec = Literal["standard_850", "standard_860", "premium_square"]
FaucetType = Literal["none", "waterfall", "gooseneck"]
DrainType = Literal["stainless_basic"]
# 문짝 구조 타입 — 평평한 통판(민짜문), 세로 기둥·가로대·알판으로 나뉜 격자문,
# 유리를 끼우는 타공문. 뒤 두 타입은 홈(굴곡)과 겹치기 시공 때문에 평판보다
# 시공 시간이 훨씬 오래 걸려, 인건비 산출에서만 난이도 할증을 받는다
# (원단 소요량은 실측 면적 그대로 — 할증은 "품이 더 든다"는 뜻이지 "필름이
# 더 든다"는 뜻이 아니다). estimator.py의 _door_labor_multiplier 참고.
DoorType = Literal["flat", "lattice", "glass"]


class PanelItem(BaseModel):
    """상/하부장, 방문, 문틀처럼 가로×세로 mm와 개수로 면적을 산출하는 개별 시공 부위 한 건.
    같은 카테고리 안에서도 규격이 다른 여러 건을 각각 추가할 수 있도록 배열로 다룬다."""

    width_mm: int = 0
    height_mm: int = 0
    count: int = 0
    # 문짝이 아닌 항목(문틀·상하부장·벽 등)에는 의미가 없어 기본값 "flat"으로 두면
    # 조용히 무시된다(할증 배수 1.0). 문짝류 입력에서만 화면에 선택지를 보여준다.
    door_type: DoorType = "flat"
    # AR 참고점 실측(components/measure/ReferenceMeasureSheet.tsx)으로 받은 치수인지.
    # false(기본값)면 사람이 직접 입력한 값이라 아래 is_manually_confirmed는 의미가 없다.
    is_ar_measured: bool = False
    # is_ar_measured=True인데 이 값이 False면 calculate_estimate가 견적 확정을 막는다
    # (_validate_ar_measurements 참고) — 참고점 간격·각도가 어긋나 실측이 크게 틀어질
    # 수 있는데, 사람이 화면에서 눈으로 보고 확인하는 단계를 건너뛴 값이 그대로 금액에
    # 반영되면 기공도 모르는 채 잘못된 견적이 나갈 수 있기 때문이다.
    is_manually_confirmed: bool = False


class FilmOptions(BaseModel):
    pattern_id: str = "matte-white"
    unit_price_per_m: int = 10_000  # 원/m — 표준 장폭 1.22m 원단 기준 사용자가 직접 입력/조정하는 단가
    needs_primer: bool = False
    # InpaintRequest.grain_horizontal과 같은 의미 — 우드 계열 자재일 때만 쓰인다.
    grain_horizontal: bool = True
    upper_cabinets: list[PanelItem] = Field(default_factory=list)
    lower_cabinets: list[PanelItem] = Field(default_factory=list)
    island_tables: list[PanelItem] = Field(default_factory=list)
    doors: list[PanelItem] = Field(default_factory=list)
    doorframes: list[PanelItem] = Field(default_factory=list)
    molding_length_m: float = 0  # 걸레받이/몰딩 총 길이
    fridge_cabinets: list[PanelItem] = Field(default_factory=list)
    pantry_cabinets: list[PanelItem] = Field(default_factory=list)
    shoe_cabinets: list[PanelItem] = Field(default_factory=list)


FireDoorSides = Literal["single", "double"]


class FireDoorItem(BaseModel):
    """현관 방화문 — 스틸 문이라 나뭇결/패턴 개념이 없고, 규격이 표준화돼 있어
    ㎡ 계산 없이 짝당 정액(단면/양면)으로 받는다. estimator.py의
    price_table.door_frame.fire_door 참고."""

    sides: FireDoorSides = "single"
    count: int = 0


class DoorFrameOptions(BaseModel):
    """문짝·문틀 시공. 필름과 같은 원단/단가 체계를 쓰지만 별도 종목으로 뽑는다 —
    현장에서 "문만 해달라"는 의뢰가 흔한데, 인테리어 필름 안에 묻혀 있으면
    견적서에 문짝 금액이 따로 나오지 않아 고객에게 설명하기 어렵다."""

    pattern_id: str = "matte-white"
    unit_price_per_m: int = 10_000
    needs_primer: bool = False
    doors: list[PanelItem] = Field(default_factory=list)
    doorframes: list[PanelItem] = Field(default_factory=list)
    fire_doors: list[FireDoorItem] = Field(default_factory=list)
    # 걸레받이/샷시/문짝처럼 기존 자재를 뜯어내는 시공엔 실리콘 마감이 따라붙는데,
    # 현장마다 필요 여부가 갈려 기본가에 묻지 않고 선택 시에만 별도 청구한다.
    silicone_recoat: bool = False


class WallFilmOptions(BaseModel):
    """벽면 시트지. 벽은 넓고 평평해 1품에 많이 붙지만, 벽지 위 시공이면
    프라이머(면처리)가 거의 필수라 그 비용이 따로 붙는다."""

    pattern_id: str = "matte-white"
    unit_price_per_m: int = 10_000
    needs_primer: bool = True
    walls: list[PanelItem] = Field(default_factory=list)
    silicone_recoat: bool = False  # 기존 실리콘 제거 및 재시공 — 기본가 불포함, 선택 시 별도 청구


class WardrobeOptions(BaseModel):
    """장롱/옷장 필름 시공. 문짝과 몸통(측판·천판)을 따로 받는다 — 문짝은 떼어내
    눕혀 붙일 수 있어 빠르지만, 몸통은 세워둔 채 좁은 틈에서 작업해 훨씬 더디다."""

    pattern_id: str = "matte-white"
    unit_price_per_m: int = 10_000
    needs_primer: bool = False
    doors: list[PanelItem] = Field(default_factory=list)  # 옷장 문짝
    bodies: list[PanelItem] = Field(default_factory=list)  # 몸통(측판·천판 등)


class MeshScreenOptions(BaseModel):
    """미세방충망 교체. 창 크기(㎡)로 원단을 잡고, 틀까지 새로 짜면 짝당 프레임비가
    따로 붙는다 — 기존 틀이 멀쩡하면 원단만 갈아 끼우는 현장이 대부분이다."""

    mesh_type: MeshType = "fine_20"
    screens: list[PanelItem] = Field(default_factory=list)  # 창 규격(가로×세로mm)×짝수
    replace_frame: bool = False  # 틀까지 새로 제작


class ToiletOptions(BaseModel):
    """변기 교체/설치. 대수 기준으로 계산한다."""

    spec: ToiletSpec = "standard"
    count: int = 0
    remove_existing: bool = True  # 기존 변기 철거·폐기
    replace_supply_line: bool = True  # 급수 호스·앙카 등 부속 교체


class SashOptions(BaseModel):
    """샷시(창틀) 필름 시공. 필름과 같은 색상 팔레트/원단 단가 체계를 쓰지만,
    창틀은 모서리·홈이 많아 인건비(품) 산출 기준이 달라 별도 항목으로 분리한다."""

    pattern_id: str = "matte-white"
    unit_price_per_m: int = 10_000  # 원/m — 표준 장폭 1.22m 원단 기준
    needs_primer: bool = False
    frames: list[PanelItem] = Field(default_factory=list)  # 창틀 규격(가로×세로mm)×개수
    silicone_recoat: bool = False  # 기존 실리콘 제거 및 재시공 — 기본가 불포함, 선택 시 별도 청구


class GlassOptions(BaseModel):
    """유리문/유리창 썬팅 시공. 일러스트(컷팅 그래픽)는 사장님 전용 "illustration" 항목으로 분리됐다."""

    work_type: GlassWorkType = "tint"
    tint_type: GlassTintType = "frosted"
    panels: list[PanelItem] = Field(default_factory=list)  # 유리 규격(가로×세로mm)×개수


class IllustrationOptions(BaseModel):
    """사장님 전용 일러스트(컷팅 그래픽) 시공. 문구·그림 설명은 이 항목 안에서 받는다."""

    count: int = 0  # 건수(건당 단가)
    text: str = ""  # 그대로 새길 문구
    description: str = ""  # 그림 설명


class LightingOptions(BaseModel):
    inch: LightingInch = "4"
    light_count: int = 0
    wiring_extension_m: float = 0


class FanOptions(BaseModel):
    fan_count: int = 0
    fan_color: str = "matte-black"  # app.catalog.PATTERNS의 색상 id 재사용
    ceiling_material: CeilingMaterial = "gypsum"
    reinforcement_area_m2: float = 0
    ceiling_height_m: float = 2.4


class SinkOptions(BaseModel):
    spec: SinkSpec = "standard_850"
    faucet_type: FaucetType = "none"
    drain_type: DrainType = "stainless_basic"


class JobOptions(BaseModel):
    film: Optional[FilmOptions] = None
    sash: Optional[SashOptions] = None
    glass: Optional[GlassOptions] = None
    lighting: Optional[LightingOptions] = None
    fan: Optional[FanOptions] = None
    sink: Optional[SinkOptions] = None
    door_frame: Optional[DoorFrameOptions] = None
    mesh_screen: Optional[MeshScreenOptions] = None
    toilet: Optional[ToiletOptions] = None
    wardrobe: Optional[WardrobeOptions] = None
    wall_film: Optional[WallFilmOptions] = None
    illustration: Optional[IllustrationOptions] = None


class ManualRegion(BaseModel):
    """수동 모드에서 사용자가 사진 위에 직접 칠해 만든 시공 영역 한 개.

    마스크 이미지 자체는 같은 multipart 요청의 masks 파일 파트로 따로 올라오고,
    여기 mask_index가 그중 몇 번째 파일인지를 가리킨다."""

    mask_index: int
    category: str
    option: str = ""
    option_label: str = ""
    # 표면 마감 변경(surface_change)인지 없던 물건 생성(object_creation)인지.
    # 이 값 하나로 백엔드 렌더링 파이프라인이 통째로 갈린다.
    task_type: Literal["surface_change", "object_creation"] = "surface_change"
    # 이 영역에 무엇을 시공할지 사람 말로 적은 것. 극사실 마스터 프롬프트는
    # 백엔드(ai_service)가 앞뒤로 합성하므로 여기엔 담지 않는다.
    prompt: str = ""
    # 이 구역에 넣을 문구나 그림 (예: "중앙에 'Cafe 1984' 텍스트 추가").
    # 상업 공간 시공에서 상호·로고를 시트지나 썬팅 위에 올릴 때 쓴다. 값이 있으면
    # ai_service가 렌더링 방식을 글자 쪽에 맞게 바꾼다.
    custom_design: str = ""
    # 문짝/문틀(door_frame) 시공에서만 의미 있음 — 원래 문이 나무(합판) 문인지,
    # 현관문·방화문처럼 페인트칠한 스틸 문인지. AI 편집 지시문이 무조건 "나뭇결을
    # 없애라"고 말하면(스틸 문에는 애초에 나뭇결이 없다) 방화문 사진에서 AI가 헷갈려
    # 결과가 안 나오거나 이상하게 나오는 원인이 됐다 — 문 재질을 정확히 알려줘 바로잡는다.
    door_material: Literal["wood", "steel"] = "wood"
    # True(기본값)면 render_region이 _reinject_structure 후처리로 원본의 윤곽·명암을
    # 결과 위에 다시 얹어 손잡이·프레임 디테일을 지킨다(object_creation은 지킬 원본
    # 구조가 없으므로 이 값과 무관하게 항상 꺼진다). False로 두면 AI가 구조에 얽매이지
    # 않고 더 자유롭게 다시 그리게 둔다 — 원본 라인이 지저분하거나, 형태 자체를
    # 과감히 바꾸고 싶을 때 쓴다.
    preserve_geometry: bool = True


class CreateJobRequest(BaseModel):
    customer_name: str = ""
    selected_items: list[WorkItemId]
    options: JobOptions = Field(default_factory=JobOptions)
    # 사장님 전용 "일러스트" 항목의 문구·그림 설명. 이 항목을 고르지 않으면 서버가 비운다.
    # 문구·설명은 견적 항목이 아니라 사진에 대한 지시라서 항목 옵션 밖에 따로 둔다.
    illustration_text: str = ""
    illustration_description: str = ""
    # "auto"는 AI가 사진에서 부위를 스스로 찾고, "manual"은 아래 manual_regions로
    # 사용자가 지정한 영역만 시공한다.
    render_mode: Literal["auto", "manual"] = "auto"
    # 자동 모드에서 사장님이 말로 적어준 요구사항.
    auto_description: str = ""
    manual_regions: list[ManualRegion] = Field(default_factory=list)


class JobCreateResponse(BaseModel):
    job_id: str
    status: Literal["queued"]


DetailCategory = Literal["material", "labor", "expense"]


class LineItemDetail(BaseModel):
    label: str
    spec: str = ""
    quantity: float = 1
    unit: str = ""
    unit_price: int = 0
    amount: int
    category: DetailCategory = "material"
    # 원단(필름) 자재 행에서만 채워진다 — app.catalog.PATTERNS의 id. 여러 항목(싱크대
    # 필름, 문짝/문틀 등)이 같은 색을 골라도 발주는 한 품번으로 묶어야 해서, 이 값으로
    # 품번별 자재 발주 집계(EstimateBreakdown.material_orders)를 만든다.
    material_code: str = ""


class LineItem(BaseModel):
    item_id: WorkItemId
    item_name: str
    details: list[LineItemDetail]
    subtotal: int


class MaterialOrderLine(BaseModel):
    """사장님 전용 자재 발주 집계 한 줄 — 같은 품번(색상/패턴)을 여러 항목(싱크대
    필름, 문짝/문틀, 벽면 등)에서 같이 골랐으면 발주는 한 번에 하므로 여기서 합친다."""

    pattern_id: str
    name: str  # app.catalog.PATTERNS의 표시명(현대보닥 품번은 "BODAQ S261" 같은 실제 코드 포함)
    color_hex: str = ""
    total_length_m: float  # 각 항목 청구 길이(로스율 반영) 합계
    order_length_m: float  # 발주 편의상 정수 미터로 올림한 값
    item_names: list[str] = Field(default_factory=list)  # 이 색을 쓴 항목들(예: "인테리어 필름", "문짝/문틀 시공")


class DepositInfo(BaseModel):
    """스케줄 락다운용 계약금 — 총액의 일부를 예약금으로 분리해 보여준다.
    비율은 pricing_store의 deposit_rate_percent(사장님 조정 가능)를 따른다."""

    rate_percent: float
    amount: int
    note: str


class RoiComparison(BaseModel):
    """영업 리포트용 — 전체 교체 대비 필름 리폼의 비용/공기 비교.
    sales_pitch(문장)와 같은 기준 품목에서 뽑아낸 숫자라 항상 서로 일치한다
    (estimator.py의 _pick_roi_item 참고)."""

    item_name: str
    replacement_cost: int
    film_cost: int
    savings_percent: int
    days_replacement: int
    days_film: int
    highlights: list[str]


class EstimateBreakdown(BaseModel):
    line_items: list[LineItem]
    ceiling_area_m2: float
    material_total: int
    labor_total: int
    expense_total: int
    supply_amount: int
    vat: int
    total_cost: int
    material_orders: list[MaterialOrderLine] = Field(default_factory=list)
    # ── 오야 견적 방어 로직 (estimator.py의 calculate_estimate 참고) ──
    # 보정 전 실제 산출 공급가액. 최소 출장비가 적용되지 않았으면 supply_amount와 같다.
    raw_supply_amount: int = 0
    min_callout_applied: bool = False
    min_callout_note: str = ""
    deposit: Optional[DepositInfo] = None
    # 문짝류(door_frame 등) 선택 시, 교체 비용과 비교하는 영업 멘트. 없으면 빈 문자열.
    sales_pitch: str = ""
    # 막대그래프·소구포인트 칩 등 "영업 리포트" UI가 쓰는 구조화된 숫자. sales_pitch가
    # 비어 있으면(교체 비교가 성립하는 품목이 없으면) 이것도 None이다.
    roi_comparison: Optional[RoiComparison] = None


class Region(BaseModel):
    id: str
    label: str
    category: str
    bbox: list[int]  # [x, y, w, h]
    mask_url: str


WorkPhotoStage = Literal["before", "progress", "after"]


class WorkPhoto(BaseModel):
    """현장에서 직접 찍어 올리는 작업 중/전후 사진 한 장.
    AI 시뮬레이션 결과(rendered_image_url)와는 별개로, 실제 시공 과정을 기록해
    블로그 후기 글의 근거 사진으로도 쓴다."""

    id: str
    url: str
    stage: WorkPhotoStage
    caption: str = ""
    uploaded_at: str


class BlogPost(BaseModel):
    title: str
    content: str
    created_at: str
    # 네이버 블로그 "1초 팩" 복사 버튼이 본문 끝에 붙여서 쓴다(blog_writer.py 참고).
    # 네이버 API 자체 포스팅은 OAuth 심사 등 제약이 커서, 서식 갖춘 텍스트를
    # 클립보드로 복사해 사장님이 직접 붙여넣는 반자동 방식으로 대신한다.
    hashtags: list[str] = Field(default_factory=list)


class Signature(BaseModel):
    """현장에서 고객이 화면에 직접 그린 서명 — 견적서 파일에만 저장된다(blog_post와 같은 방식)."""

    image: str  # "data:image/png;base64,..." 통째로 저장 — 다른 사진처럼 /static 경로가 아니다.
    signed_at: str


class SignatureRequest(BaseModel):
    image: str


class SubstrateChecklist(BaseModel):
    """시공 전 하지(바탕면) 점검 — 일본 3M 다이노크 시공 매뉴얼의 핵심 점검 항목을
    그대로 따른다(이 다섯 가지가 접착 불량의 가장 흔한 원인이다)."""

    dust_removed: bool = False  # 먼지·기름기·오염 제거
    no_unevenness: bool = False  # 요철·단차·균열 없음(있으면 퍼티로 평탄화)
    surface_dry: bool = False  # 표면 건조(함수율 8% 이하 기준)
    primer_applied: bool = False  # 약한 바탕재(석고보드 등)는 프라이머 보강
    temperature_ok: bool = False  # 시공 적정 온도(15~25℃) 확인


class SiteConditions(BaseModel):
    temperature_c: Optional[float] = None
    checklist: SubstrateChecklist = Field(default_factory=SubstrateChecklist)
    recorded_at: str


class SiteConditionsRequest(BaseModel):
    temperature_c: Optional[float] = None
    checklist: SubstrateChecklist = Field(default_factory=SubstrateChecklist)


class JobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "processing", "done", "failed"]
    # 처리 중 현재 단계("영역 인식 중" 등). 화면 표시용이자, 프론트엔드가 "총 소요
    # 시간"이 아니라 "한 단계에서 멈춘 시간"으로 실패를 판정하기 위한 진행 신호다.
    stage: Optional[str] = None
    rendered_image_url: Optional[str] = None
    original_image_url: Optional[str] = None
    mask_preview_url: Optional[str] = None
    regions: list[Region] = Field(default_factory=list)
    estimate: Optional[EstimateBreakdown] = None
    error: Optional[str] = None
    # 시공이 일부 적용되지 않았을 때 사장님에게 보여줄 안내(예: 문짝 인식 실패, AI 한도 초과).
    notices: list[str] = Field(default_factory=list)
    # 부위별 AI 인페인팅 편집 진행 상태 (전체 job 상태와 별개로 동작)
    editing: bool = False
    editing_region_id: Optional[str] = None
    edit_error: Optional[str] = None
    # 견적서 저장/불러오기용 — 완료된 견적은 고객명과 함께 저장돼 나중에 다시 불러올 수 있다.
    customer_name: str = ""
    created_at: Optional[str] = None
    # 현장 작업 사진(전/중/후)과 AI 생성 블로그 글. 둘 다 견적서 파일에만 저장되고
    # (WorkPhoto/BlogPost 참고) job이 완료된 뒤에 별도 API로 추가되므로, 기본값은
    # 항상 비어 있다가 조회 시점에 저장된 견적서에서 덧붙여진다.
    work_photos: list[WorkPhoto] = Field(default_factory=list)
    blog_post: Optional[BlogPost] = None
    signature: Optional[Signature] = None
    site_conditions: Optional[SiteConditions] = None


class InpaintRequest(BaseModel):
    region_id: str
    pattern_id: str
    # 우드 계열 자재에서만 의미가 있다(그 외엔 조용히 무시됨) — 결(나뭇결)이 가로로
    # 흐르는지 세로로 흐르는지. 문짝처럼 세로로 긴 면은 세로 결이 실제 시공과 더
    # 비슷하게 보이는 경우가 많아 사용자가 고를 수 있게 뒀다.
    grain_horizontal: bool = True
    # [중요] 이 엔드포인트(/jobs/{id}/inpaint)는 AI 인페인팅을 호출하지 않는다 —
    # run_inpaint_edit가 쓰는 recolor_surface()는 LAB 색공간에서 명암(L 채널)은
    # 그대로 두고 색(a/b 채널)만 바꾸는 결정적 연산이라, 구조가 항상 100% 보존된다
    # (그래서 이 필드는 현재 이 경로에서는 효과가 없다 — 스키마 레벨 예약 필드).
    # 실제로 구조 보존 강도를 켜고 끌 수 있는 자리는 진짜 AI 인페인팅(render_region)을
    # 타는 ManualRegion.preserve_geometry 쪽이다. 그리고 이 계정의 Replicate 인페인팅
    # 모델은 전부 ControlNet(Canny/Depth) 입력을 못 받으므로(모델 스키마 직접 조회로
    # 확인됨 — ai_service.py 상단 메모 참고) True여도 Multi-ControlNet을 타지는 않고,
    # 기존 _reinject_structure() 후처리(keep_structure)를 켜고 끄는 식으로 동작한다.
    preserve_geometry: bool = True


class IllustrationRequest(BaseModel):
    """결과 사진 옆에서 바로 요청하는 유리 일러스트 시공.
    고객이 원하는 문구/그림 설명을 받아 AI가 현재 시공 후 사진에 그려 넣는다."""

    text: str = ""
    description: str = ""


class InpaintAcceptedResponse(BaseModel):
    accepted: bool


class QuoteSummary(BaseModel):
    job_id: str
    customer_name: str
    created_at: str
    total_cost: int
    thumbnail_url: Optional[str] = None
    has_blog: bool = False


class QuoteListResponse(BaseModel):
    quotes: list[QuoteSummary]


class BlogSummary(BaseModel):
    job_id: str
    title: str
    customer_name: str
    created_at: str
    cover_image_url: Optional[str] = None
    excerpt: str = ""


class BlogListResponse(BaseModel):
    posts: list[BlogSummary]


class BlogDetailResponse(BaseModel):
    job_id: str
    title: str
    content: str
    customer_name: str
    created_at: str
    before_image_url: Optional[str] = None
    after_image_url: Optional[str] = None
    work_photos: list[WorkPhoto] = Field(default_factory=list)
    line_item_names: list[str] = Field(default_factory=list)


# ── AI 제안서(고객 발송용 상세페이지) ──────────────────────────────────
# 블로그(SEO 공개 목록)와 분리된 "고객 1명에게 보내는 비공개 링크" 용도.
# draft/review 상태에서는 공개 조회에서 숨기고, published만 외부에 노출한다.
ProposalStatus = Literal["review", "published"]


class Proposal(BaseModel):
    id: str
    status: ProposalStatus
    created_at: str
    published_at: Optional[str] = None
    # 기존 완료된 견적에서 시작했으면 채워진다 — 있으면 그 견적의 sales_pitch를
    # 카피 생성에 참고 문구로 넘긴다(estimator.py 참고). 사진 한 장만으로 독립
    # 생성한 경우에는 None.
    job_id: Optional[str] = None
    source_image_url: str
    wide_image_url: str
    detail_image_url: str
    headline: str
    body: str
    # ── job_id가 있을 때만 생성 시점에 한 번 스냅샷으로 채워지는 "풀패키지" 자료 ──
    # 나중에 견적을 고쳐도 이미 만든 제안서는 안 바뀌도록, 참조가 아니라 복사해서
    # 저장한다(job_id의 sales_pitch를 카피에 반영하는 것과 같은 원칙). 사진 한 장만의
    # 독립 생성 경로에는 애초에 이 데이터가 없으므로 전부 None으로 남고, 공유 페이지는
    # 이 네 값이 있을 때만 비포/애프터 슬라이더·ROI 그래프·정밀 견적서·바탕면 점검
    # 리포트를 보여준다.
    before_image_url: Optional[str] = None
    estimate: Optional[EstimateBreakdown] = None
    site_conditions: Optional[SiteConditions] = None


class ProposalListResponse(BaseModel):
    proposals: list[Proposal]


FeedbackTarget = Literal["detail_image", "copy"]
FeedbackAction = Literal["brighter", "darker", "shorter", "longer", "custom"]


class ProposalFeedbackRequest(BaseModel):
    target: FeedbackTarget
    action: FeedbackAction
    # action="custom"일 때만 쓰는 자연어 피드백("이 부분은 더 밝게 해줘" 등).
    note: str = ""


class ProposalPublicResponse(BaseModel):
    """공개 공유 링크(/proposal?id=...)가 쓰는 뷰 — 내부 상태(status/job_id)는 뺀다.

    blog.py의 공개 응답과 달리 estimate(정밀 견적서)를 그대로 내보낸다 — 블로그는
    불특정 다수가 보는 SEO 글이라 가격을 숨기지만, 제안서는 고객 한 명에게 직접
    보내는 견적 공유 링크라 가격을 보여주는 게 기능의 목적 그 자체다."""

    id: str
    created_at: str
    wide_image_url: str
    detail_image_url: str
    headline: str
    body: str
    before_image_url: Optional[str] = None
    estimate: Optional[EstimateBreakdown] = None
    site_conditions: Optional[SiteConditions] = None


# ── 포트폴리오 쇼케이스 (공개 갤러리) ──────────────────────────────────
# 서명 완료(status="done" & signature 있음)된 시공 건을 사장님이 따로 "발행" 버튼을
# 누르지 않아도 자동으로 모아 보여준다. blog.py는 사장님이 AI 글을 검수·발행하는
# 단계가 있지만 이쪽은 그 단계가 없어 노출 범위를 의도적으로 좁게 잡는다 — 고객
# 이름·연락처·금액은 절대 내보내지 않고 사진과 시공 항목 태그만 보여준다.
class PortfolioEntry(BaseModel):
    job_id: str
    before_image_url: Optional[str] = None
    after_image_url: Optional[str] = None
    item_tags: list[str] = Field(default_factory=list)
    completed_at: str


class PortfolioListResponse(BaseModel):
    entries: list[PortfolioEntry]


# ── 디지털 보증서 (공개, 고객 공유용) ──────────────────────────────────
# 포트폴리오 갤러리와 같은 기준(status=done & signature 있음)으로만 열린다.
# 보증 약관·유지관리 팁은 AI가 지어내면 안 되는 값이라 고정 문구를 쓴다
# (routers/warranty.py의 GENERIC_TIPS 참고 — PremiumReceipt.tsx의 보증 문구와 같은 톤).
class WarrantyResponse(BaseModel):
    job_id: str
    item_names: list[str]
    completed_at: str
    warranty_expires_at: str
    after_image_url: Optional[str] = None
    maintenance_tips: list[str]
