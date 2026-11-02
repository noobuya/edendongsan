import { compareGifUrl, fetchAssetObjectUrl, resolveAssetUrl } from "@/lib/api";
import { parseBlogSections, planBlogPhotos } from "@/lib/blogBlocks";
import { splitBoldSegments } from "@/lib/richText";
import type { WorkPhoto } from "@/types";

/** 네이버 블로그로 통째로 옮길 글 한 편. 블로그 상세 화면(/blog/post)과 사장님
 *  작업사진 패널(SitePhotoGallery)이 서로 다른 모양의 데이터를 갖고 있어서, 둘 다
 *  이 모양으로 맞춰 넘긴다. */
export interface NaverExportPost {
  title: string;
  content: string;
  hashtags: string[];
  /** 본문 맨 위 대표 사진(없으면 생략). */
  coverUrl?: string;
  photos: WorkPhoto[];
  /** 홍보 영상(MP4)을 만들어 뒀으면 그 주소 — 순서표에 "영상 저장" 단계가 생긴다. */
  videoUrl?: string | null;
  /** 블로그 글(견적) id — 있으면 비교 사진마다 "움짤(GIF) 저장"을 붙인다. */
  jobId?: string;
}

// 네이버 블로그 본문 폭이 최대 약 900px이라 그 이상은 용량만 커진다. 한 장에
// 수백 KB 수준으로 줄여야 사진이 20장 가까이 돼도 클립보드·에디터가 버틴다.
const MAX_SIDE = 1280;
const JPEG_QUALITY = 0.85;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function boldToHtml(text: string): string {
  return splitBoldSegments(text)
    .map((seg) => (seg.bold ? `<strong>${escapeHtml(seg.text)}</strong>` : escapeHtml(seg.text)))
    .join("");
}

function paragraphsHtml(content: string): string {
  return content
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${boldToHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    img.src = src;
  });
}

/** 백엔드 사진을 받아 긴 변 MAX_SIDE 이하 JPEG Blob으로 줄인다. */
async function fetchResizedJpeg(path: string): Promise<Blob> {
  const objectUrl = await fetchAssetObjectUrl(path);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 변환하지 못했습니다.");
    // PNG 투명 영역이 JPEG에서 검게 나오지 않게 흰 바탕을 먼저 깐다.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지를 변환하지 못했습니다."))), "image/jpeg", JPEG_QUALITY)
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** 블로그 상세 화면과 같은 순서 — 대표 사진 → 본문 → 시공 전/후 짝 → 남은 사진. */
function orderedSections(post: NaverExportPost) {
  const before = post.photos.filter((p) => p.stage === "before");
  const progress = post.photos.filter((p) => p.stage === "progress");
  const after = post.photos.filter((p) => p.stage === "after");
  const pairCount = Math.min(before.length, after.length);
  const pairs = Array.from({ length: pairCount }, (_, i) => [before[i], after[i]] as const);
  const rest = [...before.slice(pairCount), ...progress, ...after.slice(pairCount)];
  return { pairs, rest };
}

/** 내보낼 사진 URL 전체(중복 제거, 화면 순서 그대로). */
export function exportImageUrls(post: NaverExportPost): string[] {
  const { pairs, rest } = orderedSections(post);
  const urls = [post.coverUrl, ...pairs.flat().map((p) => p.url), ...rest.map((p) => p.url)];
  return Array.from(new Set(urls.filter((u): u is string => !!u)));
}

/** 사진 경로("/static/...")를 누구나 열 수 있는 절대 https 주소로 바꾼다. */
function publicImageUrl(path: string): string {
  return new URL(resolveAssetUrl(path), window.location.href).href;
}

/** 네이버 블로그에 붙여넣을 HTML을 만든다.
 *
 *  [사진은 반드시 공개 https 주소로 — 2026-11-02 "글만 들어가고 사진은 안 들어간다"]
 *  처음엔 사진 바이트를 data URI(<img src="data:image/jpeg;base64,...">)로 HTML 안에
 *  직접 넣었는데, 네이버 스마트에디터는 붙여넣기에서 data URI 이미지를 통째로 버린다.
 *  에디터는 <img src="https://...">를 만나면 그 주소에서 사진을 직접 받아 네이버
 *  서버에 올리므로, 우리 서버의 공개 주소(Caddy가 /static/*을 그대로 공개 —
 *  https://54-66-15-115.sslip.io)를 그대로 넣는다. 웹페이지를 드래그해 복사했을 때
 *  사진이 같이 넘어가는 것과 같은 원리다. */
export function buildNaverHtml(post: NaverExportPost): { html: string; plain: string } {
  const img = (url: string | undefined, alt: string) =>
    url
      ? `<p style="text-align:center"><img src="${escapeHtml(publicImageUrl(url))}" alt="${escapeHtml(alt)}" style="max-width:100%"></p>`
      : "";

  const { pairs, rest } = orderedSections(post);
  const parts: string[] = [];
  parts.push(`<h2>${escapeHtml(post.title)}</h2>`);
  parts.push(img(post.coverUrl, post.title));
  parts.push(paragraphsHtml(post.content));
  pairs.forEach(([b, a], i) => {
    // 네이버 에디터는 표 안 사진을 제멋대로 줄이거나 표를 깨뜨려서, 좌우 배치 대신
    // 시공 전 → 시공 후를 위아래로 이어 붙인다.
    parts.push(`<p style="text-align:center">🔨 〔시공전〕···········〔시공후〕 ✨</p>`);
    parts.push(img(b.url, `시공 전 사진 ${i + 1}`));
    parts.push(img(a.url, `시공 후 사진 ${i + 1}`));
    const caption = a.caption || b.caption;
    if (caption) parts.push(`<p style="text-align:center">${escapeHtml(caption)}</p>`);
  });
  for (const photo of rest) {
    if (photo.url === post.coverUrl) continue;
    parts.push(img(photo.url, photo.caption || "시공 사진"));
    if (photo.caption) parts.push(`<p style="text-align:center">${escapeHtml(photo.caption)}</p>`);
  }
  if (post.hashtags.length) parts.push(`<p>${post.hashtags.map(escapeHtml).join(" ")}</p>`);

  const plain = [post.title, post.content, post.hashtags.join(" ")].filter(Boolean).join("\n\n");
  return { html: parts.join(""), plain };
}

/** 화면에 안 보이는 편집 영역에 HTML을 그려 넣고 브라우저의 "복사"를 실행한다 —
 *  사람이 웹페이지를 드래그해서 Ctrl+C 한 것과 똑같아서, Clipboard API를 못 쓰는
 *  인앱 웹뷰·구형 브라우저에서도 사진까지 같이 복사된다. */
function copyHtmlViaSelection(html: string): boolean {
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.innerHTML = html;
  holder.style.cssText = "position:fixed;left:-99999px;top:0;width:800px;opacity:0;";
  document.body.appendChild(holder);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  holder.remove();
  return ok;
}

/** 사진 포함 HTML을 클립보드에 넣는다. 사진은 주소만 들어가므로 즉시 끝난다. */
export async function copyPostToClipboard(post: NaverExportPost): Promise<void> {
  const { html, plain } = buildNaverHtml(post);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // 인앱 웹뷰 등 Clipboard API가 막힌 환경 — 아래 방식으로 다시 시도.
    }
  }
  if (copyHtmlViaSelection(html)) return;
  await navigator.clipboard.writeText(plain);
  throw new Error("이 브라우저는 사진 복사를 지원하지 않아 글자만 복사했습니다. '사진 전체 저장'으로 사진을 따로 올려주세요.");
}

/** 사진 전체를 파일로 내보낸다. 휴대폰은 공유 시트(→ 갤러리 저장, 또는 네이버 블로그
 *  앱으로 바로 보내기), PC는 한 장씩 다운로드. */
export async function saveAllPhotos(
  post: NaverExportPost,
  onProgress?: (done: number, total: number) => void
): Promise<"shared" | "downloaded"> {
  const urls = exportImageUrls(post);
  const files: File[] = [];
  onProgress?.(0, urls.length);
  for (const [i, url] of urls.entries()) {
    try {
      const blob = await fetchResizedJpeg(url);
      files.push(new File([blob], `시공사진_${String(i + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }));
    } catch {
      // 받지 못한 사진은 건너뛴다.
    }
    onProgress?.(i + 1, urls.length);
  }
  if (files.length === 0) throw new Error("사진을 불러오지 못했습니다.");

  if (typeof navigator.canShare === "function" && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: post.title });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
      // 공유 실패 시 다운로드로 넘어간다.
    }
  }
  for (const file of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    // 연속 다운로드를 브라우저가 한 장만 받고 막지 않게 살짝 간격을 둔다.
    await new Promise((r) => setTimeout(r, 300));
  }
  return "downloaded";
}

// ── 한 단계씩 복사 (사진을 "파일"로 클립보드에 넣는 확실한 경로) ──────────────
// [왜 필요한가 — 2026-11-02 엣지에서 "전체 복사해도 사진은 안 들어간다"]
// 글 속 <img>(data URI든 공개 https 주소든)를 붙여넣었을 때 네이버 에디터가 사진을
// 실제로 업로드해 주는지는 에디터 쪽 정책에 달려 있어 우리가 보장할 수 없다. 반면
// 클립보드에 "사진 파일 자체"(image/png)가 들어 있으면 에디터는 화면 캡처를 붙여넣을
// 때와 똑같이 그 사진을 바로 업로드한다. 브라우저 클립보드엔 사진을 한 번에 한 장만
// 넣을 수 있어서, 글 → 사진1 → 사진2 … 순서로 하나씩 복사·붙여넣기하게 안내한다.

// [2026-11-03 "하나씩 올리면 시공 전후 사진이 안 맞는다"]
// 시공 전/후를 따로 붙이면 순서가 어긋나거나 한 장을 빠뜨려 짝이 틀어졌다. 짝은
// "시공 전 | 시공 후"를 나란히 붙인 비교 사진 한 장(kind: "pair")으로 만든다 —
// 짝이 어긋날 수 없고 붙여넣는 횟수도 절반이 된다.
export type NaverStep =
  | { kind: "text"; label: string; html: string; plain: string }
  | { kind: "photo"; label: string; url: string }
  | { kind: "pair"; label: string; before: string; after: string; gifUrl?: string }
  | { kind: "video"; label: string; url: string };

/** 단계의 사진 캐시 키 — 패널이 미리 만들어 두는 PNG를 찾을 때 쓴다. */
export function stepImageKey(step: NaverStep): string | null {
  if (step.kind === "photo") return step.url;
  if (step.kind === "pair") return `${step.before}|${step.after}`;
  return null;
}

/** 큰 문구(# ) 블록을 네이버 에디터에서도 크게 보이도록 HTML로. */
function sectionHtml(headline: string | undefined, paragraphs: string[]): string {
  const head = headline
    ? `<p style="text-align:center"><span style="font-size:26px"><b>${escapeHtml(headline)}</b></span></p>`
    : "";
  const body = paragraphs
    .map((p) => `<p style="text-align:center">${boldToHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return head + body;
}

/** [2026-11-03 "문단을 하나로 — 한 번 복사로 전체가 들어가게"]
 *  처음엔 문단마다 따로 복사해 사이사이에 사진을 넣게 했는데, 사장님은 글을 한 번에
 *  넣고 싶어 했다. 지금은 1번 단계 하나로 제목·본문 전체·해시태그를 통째로 복사하고,
 *  그 뒤에 영상 → 시공 전/후 비교 사진(+움짤·비교 영상) → 남은 사진을 이어 넣는다. */
export function buildNaverSteps(post: NaverExportPost): NaverStep[] {
  const steps: NaverStep[] = [];
  const sections = parseBlogSections(post.content);
  const { pairs, rest } = planBlogPhotos(post.photos);

  const titleHtml = `<p style="text-align:center"><span style="font-size:30px"><b>${escapeHtml(post.title)}</b></span></p>`;
  const bodyHtml = sections.map((sec) => sectionHtml(sec.headline, sec.paragraphs)).join("<p><br></p>");
  const tagsHtml = post.hashtags.length ? `<p><br></p><p>${escapeHtml(post.hashtags.join(" "))}</p>` : "";
  const plain = [
    post.title,
    ...sections.map((sec) => [sec.headline ?? "", ...sec.paragraphs].filter(Boolean).join("\n")),
    post.hashtags.join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
  steps.push({ kind: "text", label: "글 전체 (제목 + 본문 + 해시태그)", html: titleHtml + bodyHtml + tagsHtml, plain });

  if (pairs.length === 0 && post.coverUrl) steps.push({ kind: "photo", label: "대표 사진", url: post.coverUrl });
  if (post.videoUrl) steps.push({ kind: "video", label: "시공 영상 (네이버 [동영상] 버튼으로 올리기)", url: post.videoUrl });
  pairs.forEach((pair, k) => {
    steps.push({
      kind: "pair",
      label: `시공 전·후 비교 사진 ${k + 1}`,
      before: pair.before.url,
      after: pair.after.url,
      gifUrl: post.jobId ? compareGifUrl(post.jobId, k) : undefined,
    });
  });
  rest.forEach((photo, i) => {
    if (pairs.length === 0 && photo.url === post.coverUrl) return;
    const stage = photo.stage === "before" ? "시공 전" : photo.stage === "progress" ? "작업 중" : "시공 후";
    steps.push({ kind: "photo", label: `${stage} 사진 (추가 ${i + 1})`, url: photo.url });
  });
  return steps;
}

/** 사진을 클립보드용 PNG로 만든다 — 크롬·엣지 클립보드는 사진 형식으로 PNG만 받는다.
 *  너무 크면 붙여넣기가 느려져서 긴 변 1600px로 줄인다. */
export async function fetchClipboardPng(path: string): Promise<Blob> {
  const objectUrl = await fetchAssetObjectUrl(path);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 변환하지 못했습니다.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지를 변환하지 못했습니다."))), "image/png")
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** 시공 전/후 두 장을 같은 높이로 맞춰 나란히 붙이고, 위에 "시공 전 / 시공 후"
 *  라벨 띠를 얹은 비교 사진 PNG를 만든다. */
export async function fetchPairPng(beforePath: string, afterPath: string): Promise<Blob> {
  const urls = await Promise.all([fetchAssetObjectUrl(beforePath), fetchAssetObjectUrl(afterPath)]);
  try {
    const [b, a] = await Promise.all(urls.map(loadImage));
    const targetH = 1000;
    const bw = (b.naturalWidth * targetH) / b.naturalHeight;
    const aw = (a.naturalWidth * targetH) / a.naturalHeight;
    const gap = 16;
    const band = 84;
    let width = bw + gap + aw;
    // 네이버 본문에 맞게 가로 2000px를 넘지 않게 전체를 줄인다.
    const shrink = Math.min(1, 2000 / width);
    width = Math.round(width * shrink);
    const h = Math.round(targetH * shrink);
    const g = Math.round(gap * shrink);
    const bandH = Math.round(band * shrink);
    const bW = Math.round(bw * shrink);
    const aW = width - bW - g;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = h + bandH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 변환하지 못했습니다.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(b, 0, bandH, bW, h);
    ctx.drawImage(a, bW + g, bandH, aW, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.round(bandH * 0.5)}px sans-serif`;
    ctx.fillStyle = "#64748b";
    ctx.fillText("시공 전", bW / 2, bandH / 2);
    ctx.fillStyle = "#03a94e";
    ctx.fillText("시공 후 ✨", bW + g + aW / 2, bandH / 2);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지를 변환하지 못했습니다."))), "image/png")
    );
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}

/** 단계에 맞는 클립보드 PNG를 만든다. */
export function buildStepPng(step: NaverStep): Promise<Blob> | null {
  if (step.kind === "photo") return fetchClipboardPng(step.url);
  if (step.kind === "pair") return fetchPairPng(step.before, step.after);
  return null;
}

/** 단계 하나를 클립보드에 넣는다. 사진은 미리 만들어 둔 PNG(또는 만들어지는 중인
 *  Promise)를 받는다 — 버튼을 누른 그 순간에 쓰기 요청을 해야 브라우저가 허용한다. */
export async function copyNaverStep(step: NaverStep, png?: Blob | Promise<Blob>): Promise<void> {
  if (step.kind === "text") {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([step.html], { type: "text/html" }),
            "text/plain": new Blob([step.plain], { type: "text/plain" }),
          }),
        ]);
        return;
      } catch {
        // 아래 방식으로 다시 시도
      }
    }
    if (copyHtmlViaSelection(step.html)) return;
    await navigator.clipboard.writeText(step.plain);
    return;
  }
  if (step.kind === "video") {
    // 영상은 클립보드로 못 옮긴다 — 파일로 저장해 네이버 [동영상] 버튼으로 올린다.
    const res = await fetch(resolveAssetUrl(step.url));
    if (!res.ok) throw new Error("영상을 내려받지 못했습니다.");
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "시공영상.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    return;
  }
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write || !png) {
    throw new Error("이 브라우저는 사진 복사를 지원하지 않아요. '사진 전체 저장' 후 끌어다 놓아 주세요.");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}


/** 비교 움짤(GIF) 또는 같은 장면의 비교 영상(MP4)을 파일로 저장한다 — 브라우저
 *  클립보드는 GIF·영상을 못 담아서, 저장한 뒤 네이버 글쓰기의 [사진](GIF) /
 *  [동영상](MP4) 버튼으로 올린다. */
export async function saveCompareGif(url: string, index: number, format: "gif" | "mp4" = "gif"): Promise<void> {
  const res = await fetch(format === "mp4" ? `${url}?fmt=mp4` : url);
  if (!res.ok) throw new Error(format === "mp4" ? "비교 영상을 만들지 못했습니다." : "움짤을 만들지 못했습니다.");
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = format === "mp4" ? `before_after_${index}.mp4` : `before_after_${index}.gif`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
}
