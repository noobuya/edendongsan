import type {
  BlogDetail,
  BlogPost,
  BlogSummary,
  CreateJobParams,
  JobStatusResponse,
  JournalEntry,
  LineItem,
  MappedRegion,
  PanelItem,
  PortfolioEntry,
  PricingField,
  Proposal,
  ProposalFeedbackAction,
  ProposalFeedbackTarget,
  ProposalPublic,
  QuoteSummary,
  RoiComparison,
  SharedEstimate,
  SubstrateChecklist,
  WorkPhoto,
  WorkPhotoStage,
} from "@/types";

// APK(Capacitor)로 실행될 때는 기기에게 "localhost"가 곧 기기 자신이라 백엔드에
// 닿지 않는다 — .env(.local)의 NEXT_PUBLIC_API_URL로 ngrok 등 외부에서 접근 가능한
// 주소를 넣어줘야 한다. 이 파일의 모든 API 호출이 이 상수 하나만 거치므로,
// 여기 한 곳만 맞으면 앱 전체가 맞다.
// [브라우저(PC·폰)로 열 때는 주소를 고정하지 않는다]
// 예전에는 어디서 열든 NEXT_PUBLIC_API_URL(ngrok 주소) 하나만 봤다. 그러면 그 ngrok 터널이
// 꺼져 있거나 다른 프로그램이 같은 무료 고정 도메인을 가져가는 순간, 같은 PC의 localhost:3000
// 화면도 "서버에 연결되지 않았습니다"가 된다(실제로 그렇게 끊겼다).
// 일반 브라우저에서는 빈 문자열(같은 주소)로 호출하고, 그 요청은 next.config.mjs의 rewrites가
// 백엔드(8000)로 넘긴다. 삼성 인터넷처럼 ngrok 주소로 열어도 화면을 준 그 주소가 곧
// 백엔드 통로라 그대로 맞는다. APK(Capacitor)만 기기에서 PC를 볼 수 없으므로 환경변수 주소를 쓴다.
function computeApiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  if (typeof window === "undefined") return fromEnv;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return fromEnv;
  return "";
}
const API_BASE = computeApiBase();
// API_BASE가 빈 문자열(같은 주소)이면 new URL()에 기준 주소가 필요하다.
const urlBase = () => (typeof window === "undefined" ? "http://localhost" : window.location.href);

// ngrok 무료 플랜은 브라우저(WebView 포함) User-Agent로 오는 요청에 실제 응답 대신
// "방문 경고" HTML 페이지를 200 OK로 얹어 돌려준다 — 이 헤더가 없으면 폰 앱에서
// fetch().json() 파싱이 조용히 실패한다. ngrok을 쓰지 않는 배포에서는 그냥 무시되는
// 무해한 헤더이므로 모든 요청에 기본으로 붙인다.
const NGROK_SKIP_HEADER = { "ngrok-skip-browser-warning": "true" };

async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, headers: { ...NGROK_SKIP_HEADER, ...init.headers } });
  } catch {
    // fetch가 던지는 기본 오류는 "Failed to fetch" 한 줄뿐이라, 폰에서 무엇이
    // 잘못됐는지 알 길이 없다. 어디에 연결하려다 실패했는지를 그대로 보여준다.
    throw new Error(
      `서버에 연결하지 못했습니다.\n(${API_BASE})\n` +
        "PC의 백엔드와 ngrok이 켜져 있는지, 휴대폰이 인터넷에 연결돼 있는지 확인해주세요."
    );
  }
}

/** 캔버스가 만든 dataURL 마스크를 그대로 업로드할 수 있는 파일(Blob)로 바꾼다. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function panelItemsPayload(items: PanelItem[]) {
  return items.map((i) => ({
    width_mm: i.widthMm,
    height_mm: i.heightMm,
    count: i.count,
    door_type: i.doorType ?? "flat",
  }));
}

export async function createJob(
  params: CreateJobParams
): Promise<{ job_id: string; status: string }> {
  const { selectedItems, options } = params;

  const payload = {
    customer_name: params.customerName,
    selected_items: selectedItems,
    illustration_text: params.illustrationText,
    illustration_description: params.illustrationDescription,
    render_mode: params.renderMode,
    auto_description: params.autoDescription,
    // 수동 모드에서 칠한 영역들의 "설명"만 여기 담는다. 마스크 이미지는 base64로
    // 부풀려 JSON에 넣지 않고 아래에서 파일 파트로 따로 붙인다 — 영역이 늘어날수록
    // base64는 원본보다 33% 커지고 파싱도 느려진다.
    manual_regions: params.manualRegions.map((r, index) => ({
      mask_index: index,
      category: r.category,
      option: r.option,
      option_label: r.optionLabel,
      task_type: r.taskType,
      prompt: r.prompt,
      custom_design: r.customDesign ?? "",
      door_material: r.doorMaterial ?? "wood",
    })),
    options: {
      film: selectedItems.includes("film")
        ? {
            pattern_id: options.film.patternId,
            unit_price_per_m: options.film.unitPricePerM,
            needs_primer: options.film.needsPrimer,
            upper_cabinets: panelItemsPayload(options.film.upperCabinets),
            lower_cabinets: panelItemsPayload(options.film.lowerCabinets),
            island_tables: panelItemsPayload(options.film.islandTables),
            doors: panelItemsPayload(options.film.doors),
            doorframes: panelItemsPayload(options.film.doorframes),
            molding_length_m: options.film.moldingLengthM,
            fridge_cabinets: panelItemsPayload(options.film.fridgeCabinets),
            pantry_cabinets: panelItemsPayload(options.film.pantryCabinets),
            shoe_cabinets: panelItemsPayload(options.film.shoeCabinets),
          }
        : undefined,
      sash: selectedItems.includes("sash")
        ? {
            pattern_id: options.sash.patternId,
            unit_price_per_m: options.sash.unitPricePerM,
            needs_primer: options.sash.needsPrimer,
            frames: panelItemsPayload(options.sash.frames),
            silicone_recoat: options.sash.siliconeRecoat,
          }
        : undefined,
      door_frame: selectedItems.includes("door_frame")
        ? {
            pattern_id: options.door_frame.patternId,
            unit_price_per_m: options.door_frame.unitPricePerM,
            needs_primer: options.door_frame.needsPrimer,
            doors: panelItemsPayload(options.door_frame.doors),
            doorframes: panelItemsPayload(options.door_frame.doorframes),
            fire_doors: options.door_frame.fireDoors.map((d) => ({ sides: d.sides, count: d.count })),
            silicone_recoat: options.door_frame.siliconeRecoat,
          }
        : undefined,
      wall_film: selectedItems.includes("wall_film")
        ? {
            pattern_id: options.wall_film.patternId,
            unit_price_per_m: options.wall_film.unitPricePerM,
            needs_primer: options.wall_film.needsPrimer,
            walls: panelItemsPayload(options.wall_film.walls),
            silicone_recoat: options.wall_film.siliconeRecoat,
          }
        : undefined,
      wardrobe: selectedItems.includes("wardrobe")
        ? {
            pattern_id: options.wardrobe.patternId,
            unit_price_per_m: options.wardrobe.unitPricePerM,
            needs_primer: options.wardrobe.needsPrimer,
            doors: panelItemsPayload(options.wardrobe.doors),
            bodies: panelItemsPayload(options.wardrobe.bodies),
          }
        : undefined,
      mesh_screen: selectedItems.includes("mesh_screen")
        ? {
            mesh_type: options.mesh_screen.meshType,
            screens: panelItemsPayload(options.mesh_screen.screens),
            replace_frame: options.mesh_screen.replaceFrame,
          }
        : undefined,
      toilet: selectedItems.includes("toilet")
        ? {
            spec: options.toilet.spec,
            count: options.toilet.count,
            remove_existing: options.toilet.removeExisting,
            replace_supply_line: options.toilet.replaceSupplyLine,
          }
        : undefined,
      glass: selectedItems.includes("glass")
        ? {
            work_type: options.glass.workType,
            tint_type: options.glass.tintType,
            panels: panelItemsPayload(options.glass.panels),
          }
        : undefined,
      illustration: selectedItems.includes("illustration")
        ? { count: options.illustration.count }
        : undefined,
      lighting: selectedItems.includes("lighting")
        ? {
            inch: options.lighting.inch,
            light_count: options.lighting.lightCount,
            wiring_extension_m: options.lighting.wiringExtensionM,
          }
        : undefined,
      fan: selectedItems.includes("fan")
        ? {
            fan_count: options.fan.fanCount,
            fan_color: options.fan.fanColor,
            ceiling_material: options.fan.ceilingMaterial,
            reinforcement_area_m2: options.fan.reinforcementAreaM2,
            ceiling_height_m: options.fan.ceilingHeightM,
          }
        : undefined,
      sink: selectedItems.includes("sink")
        ? {
            spec: options.sink.spec,
            faucet_type: options.sink.faucetType,
            drain_type: options.sink.drainType,
          }
        : undefined,
    },
  };

  // 원본 사진 1장 + 영역별 마스크 N장 + 설명(JSON)을 한 번의 multipart 요청으로
  // 함께 보낸다. 사진과 마스크가 같은 요청 안에 있어야 서버가 짝을 잃지 않는다.
  const form = new FormData();
  form.append("photo", params.photo);
  form.append("payload", JSON.stringify(payload));
  for (const [index, region] of params.manualRegions.entries()) {
    form.append("masks", dataUrlToBlob(region.maskDataUrl), `mask_${index}.png`);
  }

  const res = await apiFetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    body: form,
    headers: ownerHeaders(params.ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "업로드에 실패했습니다."));
  return res.json();
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      // FastAPI 검증 오류(pydantic ValidationError) 목록 형태
      return body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ") || fallback;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!res.ok) throw new Error(await extractErrorMessage(res, "작업 조회에 실패했습니다."));
  return res.json();
}

export async function requestInpaint(
  jobId: string,
  regionId: string,
  patternId: string,
  grainHorizontal = true
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/inpaint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region_id: regionId, pattern_id: patternId, grain_horizontal: grainHorizontal }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "AI 편집 요청에 실패했습니다."));
}

/** 현장에서 고객이 그린 서명을 저장한다. 다른 현장 기록처럼 인증이 필요 없다
 *  (job_id를 아는 그 화면 — 사장님이 보여주고 있는 바로 그 폰 — 에서만 가능). */
export async function signJob(jobId: string, imageDataUrl: string): Promise<JobStatusResponse> {
  const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "서명 저장에 실패했습니다."));
  return res.json();
}

/** 시공 현장 조건(온도·하지 점검)을 기록한다. 서명과 달리 작업 중 수시로
 *  다시 저장할 수 있다(법적 합의가 아니라 품질관리 기록이라서). */
export async function saveSiteConditions(
  jobId: string,
  temperatureC: number | null,
  checklist: SubstrateChecklist
): Promise<JobStatusResponse> {
  const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/site_conditions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ temperature_c: temperatureC, checklist }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "현장 조건 저장에 실패했습니다."));
  return res.json();
}

/** 서명을 다시 받아야 할 때 지운다 — 사장님 전용. */
export async function clearJobSignature(jobId: string, ownerToken: string): Promise<JobStatusResponse> {
  const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/signature`, {
    method: "DELETE",
    headers: ownerHeaders(ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "서명 삭제에 실패했습니다."));
  return res.json();
}

/** 사장님 기기일 때만 관리자 토큰 헤더를 붙인다(학생 기기는 헤더 없이 보낸다). */
function ownerHeaders(token?: string | null): Record<string, string> {
  return token ? { "X-Admin-Token": token } : {};
}

export async function requestIllustration(
  jobId: string,
  text: string,
  description: string,
  ownerToken?: string | null
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/illustration`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders(ownerToken) },
    body: JSON.stringify({ text, description }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "일러스트 생성 요청에 실패했습니다."));
}

/** 결과 사진 위에서 직접 편집한(구역 나누기/크기·색 조절) 합성 결과를 시공 후
 *  사진으로 확정한다. AI 호출 없이 브라우저에서 만든 이미지를 그대로 올린다. */
export async function saveEditedImage(jobId: string, blob: Blob): Promise<{ rendered_image_url: string }> {
  const form = new FormData();
  form.append("image", blob, "edited.png");
  const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/edited_image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "편집 결과 저장에 실패했습니다."));
  return res.json();
}

/** 서버가 켜져 있는지만 확인하는 공개 핑. 인증이 필요 없다. */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// 견적서 목록·현장 사진·블로그 글은 고객 이름·금액이 들어 있는 사장님 전용 자료라
// 서버가 X-Admin-Token을 요구한다(routers/quotes.py).
export async function listQuotes(ownerToken: string, query = ""): Promise<QuoteSummary[]> {
  const url = new URL(`${API_BASE}/api/quotes`, urlBase());
  if (query) url.searchParams.set("q", query);
  const res = await apiFetch(url.toString(), { headers: ownerHeaders(ownerToken) });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "견적 목록 조회에 실패했습니다."));
  const data = await res.json();
  return data.quotes;
}

export async function uploadWorkPhoto(
  jobId: string,
  file: File,
  stage: WorkPhotoStage,
  caption: string,
  ownerToken: string
): Promise<WorkPhoto> {
  const form = new FormData();
  form.append("photo", file);
  form.append("stage", stage);
  form.append("caption", caption);
  const res = await apiFetch(`${API_BASE}/api/quotes/${jobId}/photos`, {
    method: "POST",
    body: form,
    headers: ownerHeaders(ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "현장 사진 업로드에 실패했습니다."));
  return res.json();
}

export async function deleteWorkPhoto(jobId: string, photoId: string, ownerToken: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${jobId}/photos/${photoId}`, {
    method: "DELETE",
    headers: ownerHeaders(ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "사진 삭제에 실패했습니다."));
}

export async function generateBlogPost(jobId: string, ownerToken: string): Promise<BlogPost> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${jobId}/blog`, {
    method: "POST",
    headers: ownerHeaders(ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "블로그 글 생성에 실패했습니다."));
  return res.json();
}

export async function listBlogPosts(query = ""): Promise<BlogSummary[]> {
  const url = new URL(`${API_BASE}/api/blog`, urlBase());
  if (query) url.searchParams.set("q", query);
  const res = await apiFetch(url.toString());
  if (!res.ok) throw new Error(await extractErrorMessage(res, "블로그 목록 조회에 실패했습니다."));
  const data = await res.json();
  return data.posts;
}

export async function getBlogDetail(jobId: string): Promise<BlogDetail> {
  const res = await apiFetch(`${API_BASE}/api/blog/${jobId}`);
  if (!res.ok) throw new Error(await extractErrorMessage(res, "블로그 글을 찾을 수 없습니다."));
  return res.json();
}

export async function deleteBlogPost(jobId: string, ownerToken: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${jobId}/blog`, {
    method: "DELETE",
    headers: ownerHeaders(ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "블로그 글 삭제에 실패했습니다."));
}

/** AI 제안서(고객 발송용 상세페이지) — /blog(SEO 공개 목록)와 분리된, 고객 1명에게
 *  보내는 비공개 공유 링크. 생성·피드백·발행은 사장님 전용(X-Admin-Token). */
export async function createProposal(photo: File, jobId: string | undefined, ownerToken: string): Promise<Proposal> {
  const form = new FormData();
  form.append("photo", photo);
  if (jobId) form.append("job_id", jobId);
  const res = await apiFetch(`${API_BASE}/api/proposals`, {
    method: "POST",
    body: form,
    headers: ownerHeaders(ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "제안서 생성에 실패했습니다."));
  return res.json();
}

export async function listProposals(ownerToken: string): Promise<Proposal[]> {
  const res = await apiFetch(`${API_BASE}/api/proposals`, { headers: ownerHeaders(ownerToken) });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "제안서 목록을 불러오지 못했습니다."));
  const data = await res.json();
  return data.proposals;
}

export async function getProposal(id: string, ownerToken: string): Promise<Proposal> {
  const res = await apiFetch(`${API_BASE}/api/proposals/${id}`, { headers: ownerHeaders(ownerToken) });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "제안서를 찾을 수 없습니다."));
  return res.json();
}

export async function sendProposalFeedback(
  id: string,
  target: ProposalFeedbackTarget,
  action: ProposalFeedbackAction,
  ownerToken: string,
  note = ""
): Promise<Proposal> {
  const res = await apiFetch(`${API_BASE}/api/proposals/${id}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders(ownerToken) },
    body: JSON.stringify({ target, action, note }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "다시 만들지 못했습니다."));
  return res.json();
}

export async function publishProposal(id: string, ownerToken: string): Promise<Proposal> {
  const res = await apiFetch(`${API_BASE}/api/proposals/${id}/publish`, {
    method: "POST",
    headers: ownerHeaders(ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "발행에 실패했습니다."));
  return res.json();
}

export async function deleteProposal(id: string, ownerToken: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/proposals/${id}`, {
    method: "DELETE",
    headers: ownerHeaders(ownerToken),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "제안서 삭제에 실패했습니다."));
}

export async function getProposalPublic(id: string): Promise<ProposalPublic> {
  const res = await apiFetch(`${API_BASE}/api/proposals/${id}/public`);
  if (!res.ok) throw new Error(await extractErrorMessage(res, "제안서를 찾을 수 없습니다."));
  return res.json();
}

/** 서명 완료된 시공 건 쇼케이스 — 인증 없이 누구나 볼 수 있는 공개 목록. */
export async function listPortfolio(): Promise<PortfolioEntry[]> {
  const res = await apiFetch(`${API_BASE}/api/portfolio`);
  if (!res.ok) throw new Error(await extractErrorMessage(res, "포트폴리오를 불러오지 못했습니다."));
  const data = await res.json();
  return data.entries;
}

/** 단가(공임·재료비·요율) 설정 — 대한인테리어필름 배너를 길게 눌러 여는 화면에서 쓴다.
 *  사장님 기기에서만 보고 고칠 수 있어서 X-Admin-Token이 꼭 필요하다. */
export async function getPricing(ownerToken?: string | null): Promise<PricingField[]> {
  const res = await apiFetch(`${API_BASE}/api/pricing`, { headers: ownerHeaders(ownerToken) });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "단가를 불러오지 못했습니다."));
  const data = await res.json();
  return data.fields;
}

export async function savePricing(
  values: Record<string, number>,
  ownerToken?: string | null
): Promise<PricingField[]> {
  const res = await apiFetch(`${API_BASE}/api/pricing`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...ownerHeaders(ownerToken) },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "단가 저장에 실패했습니다."));
  const data = await res.json();
  return data.fields;
}

export function resolveAssetUrl(path: string): string {
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}

/** 백엔드 이미지를 fetch로 받아 blob URL로 바꿔 돌려준다.
 *
 *  <img src="...">와 new Image()는 커스텀 헤더를 실어 보낼 방법이 없다. 그래서
 *  ngrok 무료 플랜이 위 NGROK_SKIP_HEADER 없는 이미지 요청에 사진 대신 "방문 경고"
 *  HTML(ERR_NGROK_6024)을 200 OK로 돌려주고, 그걸 이미지로 못 읽어 폰에서 사진이
 *  영영 안 뜬다(요청이 ngrok에서 막히니 백엔드 로그에도 안 남는다). fetch는 헤더를
 *  붙일 수 있으므로, 이미지도 fetch로 받아서 blob URL로 만들어 쓴다.
 *
 *  돌려준 URL은 다 쓴 뒤 호출한 쪽에서 URL.revokeObjectURL()로 해제해야 한다. */
export async function fetchAssetObjectUrl(path: string): Promise<string> {
  const res = await apiFetch(resolveAssetUrl(path));
  if (!res.ok) throw new Error(await extractErrorMessage(res, "이미지를 불러오지 못했습니다."));
  return URL.createObjectURL(await res.blob());
}

/** 결과 사진 위에 다시 잡은 구역만 새로 렌더링한다(부분 재시뮬레이션).
 *
 *  마스크는 JSON에 base64로 싣지 않고 파일 파트로 따로 붙인다 — 처음 견적을 낼 때와
 *  같은 방식이다(createJob 주석 참고). 바탕 이미지는 서버가 들고 있는 "현재 시공 후
 *  사진"을 쓰므로 여기서 보낼 필요가 없다. */
export async function remaskJob(jobId: string, regions: MappedRegion[]): Promise<void> {
  const form = new FormData();
  form.append(
    "payload",
    JSON.stringify({
      regions: regions.map((r, index) => ({
        mask_index: index,
        category: r.category,
        option: r.option,
        option_label: r.optionLabel,
        task_type: r.taskType,
        custom_design: r.customDesign ?? "",
        door_material: r.doorMaterial ?? "wood",
      })),
    })
  );
  for (const [index, region] of regions.entries()) {
    form.append("masks", dataUrlToBlob(region.maskDataUrl), `remask_${index}.png`);
  }

  const res = await apiFetch(`${API_BASE}/api/jobs/${jobId}/remask`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "다시 적용에 실패했습니다."));
}

// ---- 빠른 견적(견적 계산기) ----
// 단가표는 백엔드가 /estimator 아래로 함께 서비스하는 견적 계산기(estimator_app/app.py)
// 한 곳에만 둔다. 화면에 같은 가격을 또 적어 두면 두 곳이 어긋난다.

export interface EstimatorItem {
  /** 목록에서 묶는 이름(필름 시공 / 전기·조명 / 설비). */
  group: string;
  label: string;
  icon: string;
  price: number;
  chip?: [string, string];
  design_type: string | null;
  film_meters: number;
  /** 있는 품목(문짝/몰딩/샷시류)만 영업 멘트 비교 기준으로 쓰인다. */
  replacement_cost_reference?: number;
}

export type DoorDesignType = "flat" | "pattern";

/** DOOR_SET 수량 전체에 같이 적용되는 크기/디자인 — 알판·무늬를 고르면 문 크기에
 *  비례해 할증이 자동으로 붙는다(estimator_app._door_set_surcharge 참고). */
export interface DoorDetail {
  design_type: DoorDesignType;
  width_mm?: number;
  height_mm?: number;
}

export interface EstimatorLine {
  code: string;
  label: string;
  icon: string;
  design_type: string | null;
  unit_price: number;
  surcharge_per_unit: number;
  qty: number;
  line_total: number;
  note: string;
  replacement_cost_reference: number | null;
}

export interface EstimatorDeposit {
  rate_percent: number;
  amount: number;
  note: string;
}

export interface EstimatorResult {
  breakdown: EstimatorLine[];
  total: number;
  /** 최소 출장비 보정 전 실제 산출 금액. 보정이 없었으면 total과 같다. */
  raw_total: number;
  min_callout_applied: boolean;
  min_callout_note: string;
  deposit: EstimatorDeposit;
  /** 문짝/몰딩/샷시류를 골랐을 때만 채워진다. 없으면 빈 문자열. */
  sales_pitch: string;
  roi_comparison: RoiComparison | null;
  /** 사장님 전용 — 고객 화면에 그리지 않는다. */
  margin_analysis: {
    film_meters: number;
    material_cost: number;
    material_ratio: number;
    labor_margin: number;
    labor_margin_ratio: number;
  };
}

export async function getEstimatorItems(): Promise<Record<string, EstimatorItem>> {
  const res = await apiFetch(`${API_BASE}/estimator/api/items`);
  if (!res.ok) throw new Error("품목 목록을 불러오지 못했습니다.");
  return res.json();
}

export async function calculateEstimator(
  selections: Record<string, number>,
  doorDetail?: DoorDetail,
  addons?: Record<string, string[]>
): Promise<EstimatorResult> {
  const res = await apiFetch(`${API_BASE}/estimator/api/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selections, door_detail: doorDetail, addons }),
  });
  if (!res.ok) throw new Error("견적 계산에 실패했습니다.");
  return res.json();
}

// 빠른 견적(estimator_app, Flask)의 원자재값·공임비 단가 설정. 메인 견적(AI 시뮬레이션)의
// /api/pricing과 같은 계약({fields}/{values})을 쓰므로 PricingSheet를 그대로 재사용한다.
export async function getEstimatorPricing(): Promise<PricingField[]> {
  const res = await apiFetch(`${API_BASE}/estimator/api/pricing`);
  if (!res.ok) throw new Error(await extractErrorMessage(res, "단가를 불러오지 못했습니다."));
  const data = await res.json();
  return data.fields;
}

export async function saveEstimatorPricing(values: Record<string, number>): Promise<PricingField[]> {
  const res = await apiFetch(`${API_BASE}/estimator/api/pricing`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "단가 저장에 실패했습니다."));
  const data = await res.json();
  return data.fields;
}

// ---- 자동화 작업(수강생 코드로 접근, 서버 대기열에서 1건씩 처리) ----

export interface AutomationField {
  key: string;
  label: string;
  type: "text" | "number" | "password" | "textarea";
  required: boolean;
  secret: boolean;
  placeholder: string;
}
export interface AutomationTask {
  id: string;
  title: string;
  description: string;
  fields: AutomationField[];
}
export interface AutomationJob {
  id: string;
  task: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  position: number | null;
  log: string[];
  result: Record<string, unknown> | null;
  error: string | null;
  created: number;
  finished: number | null;
}

async function automationFetch<T>(path: string, code: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/automation${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Access-Code": code, ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}

export const automationLogin = (code: string) =>
  automationFetch<{ name: string }>("/login", code, { method: "POST", body: JSON.stringify({ code }) });
/** 학생 가입(승인) 요청. 코드 없이 이름만 보내고, 받은 요청 번호로 승인 여부를 확인한다. */
export type AccessRequest = { id: string; status: "pending" | "approved" | "rejected"; name: string; code?: string };

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/automation${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}

export type SignupPayload = { name: string; birth: string; phone: string; consent: boolean };
export const automationRequestAccess = (payload: SignupPayload) =>
  requestJson<AccessRequest>("/requests", { method: "POST", body: JSON.stringify(payload) });
export const automationRequestStatus = (id: string) => requestJson<AccessRequest>(`/requests/${id}`);

export const automationTasks = (code: string) => automationFetch<AutomationTask[]>("/tasks", code);
export const automationJobs = (code: string) => automationFetch<AutomationJob[]>("/jobs", code);
export const automationCreate = (code: string, task: string, params: Record<string, string>) =>
  automationFetch<AutomationJob>("/jobs", code, { method: "POST", body: JSON.stringify({ task, params }) });
export const automationCancel = (code: string, id: string) =>
  automationFetch<{ ok: boolean }>(`/jobs/${id}`, code, { method: "DELETE" });

/** 수강생 피드백. 작업 한 건(job_id)에 대한 것이거나 일반 의견이다. */
export type FeedbackKind = "bug" | "improve" | "other";
export const automationSendFeedback = (
  code: string,
  payload: { kind: FeedbackKind; message: string; job_id?: string },
) => automationFetch<{ id: string }>("/feedback", code, { method: "POST", body: JSON.stringify(payload) });

/** 관리자 화면 전용: 수강생 코드 목록·추가·삭제. 토큰은 서버 .env의 ADMIN_TOKEN과 같아야 한다. */
export type AdminStudent = {
  name: string;
  code: string | null;
  source: string;
  created: string;
  birth?: string;
  phone?: string;
};

async function adminFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/admin/students${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Admin-Token": token, ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}

export const adminListStudents = (token: string) => adminFetch<AdminStudent[]>("", token);

/** 저장된 사장님 토큰이 아직 맞는지 서버에 물어본다.
 *  "rejected"는 토큰이 틀렸다는 뜻이고, "offline"은 서버에 닿지 못했다는 뜻이다(토큰은 지우지 않는다). */
export async function checkOwnerToken(token: string): Promise<"ok" | "rejected" | "offline"> {
  try {
    const res = await apiFetch(`${API_BASE}/api/admin/students`, { headers: { "X-Admin-Token": token } });
    if (res.ok) return "ok";
    return res.status === 401 || res.status === 403 ? "rejected" : "offline";
  } catch {
    return "offline";
  }
}

export type AdminRequest = {
  id: string;
  name: string;
  status: "pending" | "approved" | "rejected";
  created: string;
  birth?: string;
  phone?: string;
};
async function adminRequestFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/admin/students/requests${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Admin-Token": token, ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}
export const adminListRequests = (token: string) => adminRequestFetch<AdminRequest[]>("", token);
export const adminApproveRequest = (token: string, id: string, code: string) =>
  adminRequestFetch<{ ok: boolean; name: string; code: string }>(`/${id}/approve`, token, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
export const adminRejectRequest = (token: string, id: string) =>
  adminRequestFetch<{ ok: boolean }>(`/${id}/reject`, token, { method: "POST" });
export const adminAddStudent = (token: string, name: string) =>
  adminFetch<AdminStudent>("", token, { method: "POST", body: JSON.stringify({ name }) });
export const adminRemoveStudent = (token: string, name: string) =>
  adminFetch<{ ok: boolean }>(`/${encodeURIComponent(name)}`, token, { method: "DELETE" });

/* 관리자 자동화 화면 (/admin/automation). 토큰은 X-Admin-Token으로 보낸다. */
export type FeedbackStatus = "received" | "reviewing" | "done" | "hold";
export interface AutomationFeedback {
  id: string;
  owner: string;
  kind: FeedbackKind;
  message: string;
  job_id: string | null;
  status: FeedbackStatus;
  admin_note: string;
  created: number;
  context: {
    task?: string;
    status?: AutomationJob["status"];
    error?: string | null;
    params?: Record<string, string>;
    log_tail?: string[];
    missing?: boolean;
  };
}
export interface AdminAutomationJob {
  id: string;
  owner: string;
  task: string;
  status: AutomationJob["status"];
  params: Record<string, string>;
  log: string[];
  error: string | null;
  created: number;
  finished: number | null;
}

async function adminAutomationFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/admin/automation${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Admin-Token": token, ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}

export const adminAutomationTasks = (token: string) => adminAutomationFetch<AutomationTask[]>("/tasks", token);
export const adminAutomationJobs = (token: string) => adminAutomationFetch<AdminAutomationJob[]>("/jobs", token);
export const adminAutomationFeedback = (token: string) =>
  adminAutomationFetch<AutomationFeedback[]>("/feedback", token);
export const adminAutomationUpdateFeedback = (token: string, id: string, status: FeedbackStatus, adminNote: string) =>
  adminAutomationFetch<AutomationFeedback>(`/feedback/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify({ status, admin_note: adminNote }),
  });
export const adminAutomationRerun = (token: string, jobId: string, params: Record<string, string>) =>
  adminAutomationFetch<AutomationJob>(`/jobs/${encodeURIComponent(jobId)}/rerun`, token, {
    method: "POST",
    body: JSON.stringify({ params }),
  });

/* ---- 견적 공유 커뮤니티. 고객 정보가 없어 조회·등록에 인증이 필요 없다 ---- */
export const createSharedEstimate = (payload: {
  author: string;
  item_names: string[];
  line_items: LineItem[];
  total_cost: number;
  note: string;
}) =>
  apiFetch(`${API_BASE}/api/community/estimates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => {
    if (!res.ok) throw new Error(await extractErrorMessage(res, "공유에 실패했습니다."));
    return res.json() as Promise<SharedEstimate>;
  });
export const listSharedEstimates = (q = "") => {
  const url = new URL(`${API_BASE}/api/community/estimates`, urlBase());
  if (q) url.searchParams.set("q", q);
  return apiFetch(url.toString()).then(async (res) => {
    if (!res.ok) throw new Error(await extractErrorMessage(res, "목록을 불러오지 못했습니다."));
    return res.json() as Promise<SharedEstimate[]>;
  });
};
export const getSharedEstimate = (id: string) =>
  apiFetch(`${API_BASE}/api/community/estimates/${encodeURIComponent(id)}`).then(async (res) => {
    if (!res.ok) throw new Error(await extractErrorMessage(res, "공유된 견적을 찾을 수 없습니다."));
    return res.json() as Promise<SharedEstimate>;
  });
export const deleteSharedEstimate = (id: string, ownerToken: string) =>
  apiFetch(`${API_BASE}/api/community/estimates/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: ownerHeaders(ownerToken),
  }).then(async (res) => {
    if (!res.ok) throw new Error(await extractErrorMessage(res, "삭제에 실패했습니다."));
  });

/* ---- 개인 작업 일지. X-Access-Code면 본인 글만, 사장님 토큰이면 전체(관리자용) ---- */
async function journalFetch<T>(path: string, code: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/journal${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Access-Code": code, ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}
export const createJournalEntry = (code: string, title: string, content: string) =>
  journalFetch<JournalEntry>("", code, { method: "POST", body: JSON.stringify({ title, content }) });
export const listJournalEntries = (code: string) => journalFetch<JournalEntry[]>("", code);
export const getJournalEntry = (code: string, id: string) =>
  journalFetch<JournalEntry>(`/${encodeURIComponent(id)}`, code);
export const updateJournalEntry = (code: string, id: string, title: string, content: string) =>
  journalFetch<JournalEntry>(`/${encodeURIComponent(id)}`, code, {
    method: "PATCH",
    body: JSON.stringify({ title, content }),
  });
export const deleteJournalEntry = (code: string, id: string) =>
  journalFetch<{ ok: boolean }>(`/${encodeURIComponent(id)}`, code, { method: "DELETE" });
export const uploadJournalPhoto = (code: string, id: string, file: File, caption: string) => {
  const form = new FormData();
  form.append("photo", file);
  form.append("caption", caption);
  return apiFetch(`${API_BASE}/api/journal/${encodeURIComponent(id)}/photos`, {
    method: "POST",
    body: form,
    headers: { "X-Access-Code": code },
  }).then(async (res) => {
    if (!res.ok) throw new Error(await extractErrorMessage(res, "사진 업로드에 실패했습니다."));
    return res.json() as Promise<JournalEntry>;
  });
};
export const deleteJournalPhoto = (code: string, id: string, photoId: string) =>
  journalFetch<JournalEntry>(`/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`, code, {
    method: "DELETE",
  });

/** 관리자 화면 전용: 전체 학생 일지 조회(특정 학생만 보려면 owner에 이름을 넣는다), 모더레이션 삭제. */
export const adminListJournalEntries = (token: string, owner = "") => {
  const url = new URL(`${API_BASE}/api/journal`, urlBase());
  if (owner) url.searchParams.set("owner", owner);
  return apiFetch(url.toString(), { headers: { "X-Admin-Token": token } }).then(async (res) => {
    if (!res.ok) throw new Error(await extractErrorMessage(res, "목록을 불러오지 못했습니다."));
    return res.json() as Promise<JournalEntry[]>;
  });
};
export const adminGetJournalEntry = (token: string, id: string) =>
  apiFetch(`${API_BASE}/api/journal/${encodeURIComponent(id)}`, { headers: { "X-Admin-Token": token } }).then(
    async (res) => {
      if (!res.ok) throw new Error(await extractErrorMessage(res, "일지를 찾을 수 없습니다."));
      return res.json() as Promise<JournalEntry>;
    }
  );
export const adminDeleteJournalEntry = (token: string, id: string) =>
  apiFetch(`${API_BASE}/api/journal/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-Admin-Token": token },
  }).then(async (res) => {
    if (!res.ok) throw new Error(await extractErrorMessage(res, "삭제에 실패했습니다."));
  });

/* ---- 현장 실습 매칭 & 스킬 뱃지 (자동화 기능과 같은 가입신청→관리자승인→코드 방식) ---- */
export type RecruitingRole = "EXPERT" | "STUDENT";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type JobStatusValue = "OPEN" | "CLOSED" | "COMPLETED";
export type ApplicationStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
export type JobAudience = "STUDENT" | "EXPERT";
export type ScoutStatusValue = "PENDING" | "ACCEPTED" | "DECLINED";
export type CommunityCategoryValue = "TIP" | "MATERIAL_SHARE" | "QNA";

export interface RecruitingUser {
  id: number;
  name: string;
  role: RecruitingRole | "ADMIN";
  phone_number: string;
  daily_wage: number;
  approval_status: ApprovalStatus;
  xp: number;
  level: number;
  badge_count: number;
}
export interface RecruitingSignupResult {
  request_token: string;
  name: string;
  approval_status: ApprovalStatus;
}
export interface RecruitingSignupStatus {
  name: string;
  approval_status: ApprovalStatus;
  access_code: string | null;
}
export interface SkillBadge {
  id: number;
  badge_name: string;
  description: string;
  tier: number;
  is_official: boolean;
  requires_endorsements: number;
}
export interface MyBadge {
  badge_id: number;
  badge_name: string;
  description: string;
  acquired_date: string;
}
export interface FieldJob {
  id: number;
  expert_id: number;
  location: string;
  job_date: string;
  required_badge_id: number;
  required_badge_name: string;
  pay: number;
  status: JobStatusValue;
  audience: JobAudience;
}
export interface JobApplication {
  id: number;
  job_id: number;
  student_id: number;
  status: ApplicationStatusValue;
  applied_at: string;
}
export interface MyApplication {
  id: number;
  status: ApplicationStatusValue;
  applied_at: string;
  job_id: number;
  job_location: string;
  job_date: string;
  job_pay: number;
  job_status: JobStatusValue;
}
export interface Applicant {
  id: number;
  status: ApplicationStatusValue;
  applied_at: string;
  student_id: number;
  student_name: string;
  student_phone: string;
  student_level: number;
  student_badge_count: number;
}

export interface JobReview {
  id: number;
  job_application_id: number;
  reviewer_id: number;
  rating: number;
  recommended_badge_id: number | null;
  comment: string;
  created_at: string;
}
export interface StudentDirectoryRow {
  id: number;
  name: string;
  level: number;
  xp: number;
  badge_count: number;
  badge_names: string[];
}
export interface ScoutRequest {
  id: number;
  scout_id: number;
  scout_name: string;
  target_user_id: number;
  target_name: string;
  field_job_id: number | null;
  message: string;
  status: ScoutStatusValue;
  created_at: string;
}
export interface CommunityPost {
  id: number;
  author_id: number;
  author_name: string;
  author_level: number;
  category: CommunityCategoryValue;
  title: string;
  body: string;
  created_at: string;
  comment_count: number;
}
export interface CommunityComment {
  id: number;
  post_id: number;
  author_id: number;
  author_name: string;
  author_level: number;
  body: string;
  created_at: string;
}
export interface CommunityPostDetail extends CommunityPost {
  comments: CommunityComment[];
}

async function recruitingFetch<T>(path: string, code: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/recruiting${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Access-Code": code, ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}
async function recruitingPublicFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/recruiting${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}

export const recruitingSignup = (payload: {
  name: string;
  role: RecruitingRole;
  phone_number: string;
  daily_wage?: number;
}) => recruitingPublicFetch<RecruitingSignupResult>("/signup", { method: "POST", body: JSON.stringify(payload) });
export const recruitingSignupStatus = (requestToken: string) =>
  recruitingPublicFetch<RecruitingSignupStatus>(`/signup/${encodeURIComponent(requestToken)}`);

export const recruitingMe = (code: string) => recruitingFetch<RecruitingUser>("/me", code);
export const recruitingBadges = (code: string) => recruitingFetch<SkillBadge[]>("/badges", code);
export const recruitingMyBadges = (code: string) => recruitingFetch<MyBadge[]>("/me/badges", code);
export const recruitingMyApplications = (code: string) => recruitingFetch<MyApplication[]>("/me/applications", code);
export const recruitingOpenJobs = (code: string) => recruitingFetch<FieldJob[]>("/field-jobs", code);
export const recruitingMyJobs = (code: string) => recruitingFetch<FieldJob[]>("/me/field-jobs", code);
export const recruitingCreateJob = (
  code: string,
  payload: { location: string; job_date: string; required_badge_id: number; pay: number; audience?: JobAudience },
) => recruitingFetch<FieldJob>("/field-jobs", code, { method: "POST", body: JSON.stringify(payload) });
export const recruitingApply = (code: string, jobId: number) =>
  recruitingFetch<JobApplication>(`/field-jobs/${jobId}/apply`, code, { method: "POST" });
export const recruitingApplicants = (code: string, jobId: number) =>
  recruitingFetch<Applicant[]>(`/field-jobs/${jobId}/applications`, code);
export const recruitingDecide = (code: string, jobId: number, applicationId: number, status: "APPROVED" | "REJECTED") =>
  recruitingFetch<JobApplication>(`/field-jobs/${jobId}/applications/${applicationId}/decision`, code, {
    method: "POST",
    body: JSON.stringify({ status }),
  });

/* ---- 레벨 기반 생태계 — 현장 완료/리뷰, 지명 호출, 커뮤니티 ---- */
export const recruitingCompleteApplication = (code: string, jobId: number, applicationId: number) =>
  recruitingFetch<JobApplication>(`/field-jobs/${jobId}/applications/${applicationId}/complete`, code, {
    method: "POST",
  });
export const recruitingReviewApplication = (
  code: string,
  jobId: number,
  applicationId: number,
  payload: { rating: number; recommended_badge_id?: number | null; comment?: string },
) =>
  recruitingFetch<JobReview>(`/field-jobs/${jobId}/applications/${applicationId}/review`, code, {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const recruitingMyReviews = (code: string) => recruitingFetch<JobReview[]>("/me/reviews", code);

export const recruitingStudents = (code: string) => recruitingFetch<StudentDirectoryRow[]>("/students", code);
export const recruitingCreateScoutRequest = (
  code: string,
  payload: { target_user_id: number; field_job_id?: number | null; message?: string },
) => recruitingFetch<ScoutRequest>("/scout-requests", code, { method: "POST", body: JSON.stringify(payload) });
export const recruitingMyScoutRequests = (code: string) => recruitingFetch<ScoutRequest[]>("/me/scout-requests", code);
export const recruitingMySentScoutRequests = (code: string) =>
  recruitingFetch<ScoutRequest[]>("/me/scout-requests/sent", code);
export const recruitingDecideScoutRequest = (code: string, requestId: number, status: "ACCEPTED" | "DECLINED") =>
  recruitingFetch<ScoutRequest>(`/scout-requests/${requestId}/decision`, code, {
    method: "POST",
    body: JSON.stringify({ status }),
  });

export const recruitingCommunityPosts = (code: string) => recruitingFetch<CommunityPost[]>("/community/posts", code);
export const recruitingCreateCommunityPost = (
  code: string,
  payload: { category: CommunityCategoryValue; title: string; body: string },
) => recruitingFetch<CommunityPost>("/community/posts", code, { method: "POST", body: JSON.stringify(payload) });
export const recruitingCommunityPostDetail = (code: string, postId: number) =>
  recruitingFetch<CommunityPostDetail>(`/community/posts/${postId}`, code);
export const recruitingCreateCommunityComment = (code: string, postId: number, body: string) =>
  recruitingFetch<CommunityComment>(`/community/posts/${postId}/comments`, code, {
    method: "POST",
    body: JSON.stringify({ body }),
  });

/* 관리자 화면 전용(/admin/recruiting): 가입 승인/거절, 뱃지·계정 직접 생성. */
async function adminRecruitingFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/recruiting${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Admin-Token": token, ...init.headers },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, "요청에 실패했습니다."));
  return res.json();
}
export const adminRecruitingRequests = (token: string) => adminRecruitingFetch<RecruitingUser[]>("/admin/requests", token);
export const adminRecruitingApprove = (token: string, userId: number, accessCode: string) =>
  adminRecruitingFetch<RecruitingUser>(`/admin/requests/${userId}/approve`, token, {
    method: "POST",
    body: JSON.stringify({ access_code: accessCode }),
  });
export const adminRecruitingReject = (token: string, userId: number) =>
  adminRecruitingFetch<RecruitingUser>(`/admin/requests/${userId}/reject`, token, { method: "POST" });
export const adminRecruitingBadges = (token: string) => adminRecruitingFetch<SkillBadge[]>("/admin/badges", token);
export const adminRecruitingCreateBadge = (
  token: string,
  payload: { badge_name: string; description: string; tier?: number; is_official?: boolean; requires_endorsements?: number },
) =>
  adminRecruitingFetch<SkillBadge>("/admin/badges", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const adminRecruitingAwardBadge = (token: string, userId: number, badgeId: number) =>
  adminRecruitingFetch<{ user_id: number; badge_id: number }>(`/admin/users/${userId}/badges/${badgeId}`, token, {
    method: "POST",
  });
