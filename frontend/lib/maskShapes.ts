/** 수동 마스킹에 쓰는 벡터 도형과, 그 도형을 AI용 흑백 마스크로 굽는 코드.
 *
 *  [왜 붓질이 아니라 도형인가]
 *  예전에는 굵은 붓으로 자유롭게 칠했다. 그런데 시공 대상은 싱크대 문짝·창문·천장처럼
 *  전부 직선으로 된 물건이고, 사진에는 원근 때문에 기울어진 사각형으로 찍힌다.
 *  손으로 칠하면 경계가 삐뚤빼뚤해져서 AI 결과물의 시트지 가장자리가 우글거렸다 —
 *  고객에게 보여줄 수 있는 품질이 아니다.
 *
 *  그래서 꼭짓점을 잡아 끌 수 있는 도형으로 바꿨다. 네 점을 문짝 모서리에 맞추면
 *  마름모/사다리꼴이 되어 원근이 그대로 표현되고, 마스크 경계가 칼같이 떨어진다.
 *
 *  좌표는 전부 "사진 원본 픽셀"이다. 화면 크기로 저장하면 폰을 접었다 펴거나
 *  확대 배율이 달라질 때 시공 위치가 어긋난다. */

export interface Pt {
  x: number;
  y: number;
}

export type Tool = "polygon" | "freehand" | "ellipse" | "select";

/** 이 클래스가 붙은 요소에서 시작한 1손가락 제스처는 화면 이동(패닝)으로 넘기지
 *  않는다 — 꼭짓점을 끌어야 하기 때문이다. react-zoom-pan-pinch의 panning.excluded가
 *  이벤트 대상(=Konva가 만든 canvas)의 클래스만 검사하므로 캔버스에 직접 붙인다.
 *
 *  Konva를 쓰는 컴포넌트가 아니라 이 파일에 두는 이유: ShapeCanvas는 ssr:false로
 *  동적 로드되는데, 다른 파일이 거기서 값을 하나라도 정적으로 import하면 그 모듈이
 *  서버 번들에 딸려 들어가 동적 로드가 무의미해진다(Konva는 서버에서 못 돈다). */
export const DRAW_LAYER_CLASS = "mask-draw-layer";

/** 확대/이동 영역 안에 놓인 버튼에 붙이는 클래스.
 *
 *  react-zoom-pan-pinch는 자기 영역에서 시작한 터치에 preventDefault를 걸어 화면을
 *  끌 준비를 하는데, 그러면 브라우저가 만들어 주는 click이 취소된다 — 즉 확대 영역
 *  안의 HTML 버튼은 손가락으로 눌러도 아무 일도 일어나지 않는다(PC 마우스로는
 *  멀쩡해서 폰에서만 "버튼이 안 먹는" 증상으로 나타난다).
 *  이 클래스를 panning.excluded에 넣어 그 터치는 패닝으로 가로채지 않게 한다. */
export const UI_CONTROL_CLASS = "mask-ui-control";

/** 시트지·썬팅처럼 평면을 덮는 영역. 꼭짓점을 옮겨 원근을 맞춘다. */
export interface PolygonShape {
  id: number;
  kind: "polygon";
  points: Pt[];
}

/** 실링팬·다운라이트처럼 둥근 물건. 천장을 비스듬히 보면 원은 찌그러진 타원으로
 *  보이므로 가로/세로 반지름과 회전각을 따로 둔다. */
export interface EllipseShape {
  id: number;
  kind: "ellipse";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
}

/** 손으로(또는 AI가) 표시한 영역 — 갤럭시 AI 사진편집의 "자석 올가미"와 같은 방식.
 *  한 획(stroke)은 손가락을 따라가되 사진의 실제 가장자리에 달라붙어(자석처럼)
 *  그어지고, 손을 떼면 닫힌 윤곽으로 채워진다. 한 번에 다 못 잡았으면 덜 잡힌
 *  부분을 다시 긋거나(strokes가 여러 개) 물체를 꾹 눌러 AI가 찾아준 윤곽을
 *  더하면(합집합) 기존 영역과 겹쳐 그려져 하나로 합쳐진 것처럼 보인다 — 실제
 *  기하 합집합 계산 없이, 반투명 채우기를 겹쳐 그리는 것만으로 같은 효과를 낸다.
 *  radiusPx는 점 하나짜리(콕 찍은) 획을 작은 원으로 채울 때만 쓰는 반지름이다. */
export interface BrushShape {
  id: number;
  kind: "brush";
  strokes: Pt[][];
  radiusPx: number;
}

export type MaskShape = PolygonShape | EllipseShape | BrushShape;

/** 점 하나짜리 획(콕 찍기)을 채울 때 쓰는 반지름(화면 기준 px). 호출부에서
 *  unit을 곱해 사진 원본 픽셀/캔버스 표시 배율로 환산한다. */
export const BRUSH_RADIUS_SCREEN_PX = 16;

/** [자석(가장자리 스냅) 올가미]
 *  손가락이 지나는 자리 근처에서 사진의 실제 가장자리(색이 확 바뀌는 자리)를
 *  찾아 그 위로 선을 당겨 붙인다 — 손이 삐뚤어도 선은 문짝 테두리에 달라붙는다.
 *
 *  매 touchmove마다 사진 전체에서 가장자리를 다시 찾으면 느리므로, 사진을 불러올
 *  때 가장자리 세기 지도(흑백, 밝을수록 가장자리)를 한 번만 만들어 둔다. 원본
 *  해상도 그대로 쓰면 지도가 너무 커 느려지므로 긴 변을 EDGE_MAP_MAX_DIM으로
 *  줄여서 계산하고, 좌표 변환은 호출부에서 scale로 되돌린다. */
const EDGE_MAP_MAX_DIM = 900;
/** 가장자리를 찾는 반경(사진 원본 픽셀 기준) — 사진 짧은 변의 비율로 잡아
 *  해상도가 달라도 "손가락 한 마디 정도" 느낌을 유지한다. */
const EDGE_SNAP_RADIUS_FRACTION = 0.018;
const EDGE_SNAP_RADIUS_MIN_PX = 10;
const EDGE_SNAP_RADIUS_MAX_PX = 44;
/** 이보다 약한 가장자리는 "가장자리가 아니다"로 보고 원래 손가락 자리를 그대로 쓴다
 *  — 텅 빈 벽처럼 특징이 없는 자리에서 엉뚱한 잡음 픽셀로 선이 튀는 것을 막는다. */
const EDGE_SNAP_MIN_STRENGTH = 40;

export interface EdgeMap {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** edgeMapPx = naturalPx * scale */
  scale: number;
}

/** 소벨(Sobel) 연산으로 사진의 가장자리 세기 지도를 만든다. 그레이스케일로
 *  바꾼 뒤 가로/세로 밝기 변화량을 합쳐 "여기가 경계다"를 점수로 남긴다. */
export function computeEdgeMap(img: HTMLImageElement, naturalW: number, naturalH: number): EdgeMap | null {
  const scale = Math.min(1, EDGE_MAP_MAX_DIM / Math.max(naturalW, naturalH));
  const w = Math.max(1, Math.round(naturalW * scale));
  const h = Math.max(1, Math.round(naturalH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const { data: rgba } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    gray[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }

  const edge = new Uint8ClampedArray(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        gray[i - w - 1] - gray[i - w + 1] + 2 * gray[i - 1] - 2 * gray[i + 1] + gray[i + w - 1] - gray[i + w + 1];
      const gy =
        gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1] - gray[i + w - 1] - 2 * gray[i + w] - gray[i + w + 1];
      edge[i] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
    }
  }
  return { data: edge, width: w, height: h, scale };
}

/** naturalPt 근처에서 가장 강한 가장자리를 찾아 그 자리로 당긴다. 강한 가장자리가
 *  없으면(평평한 벽 등) 원래 점을 그대로 돌려준다. */
export function snapToEdge(map: EdgeMap, naturalPt: Pt, naturalShortSide: number): Pt {
  const { data, width, height, scale } = map;
  const radiusNatural = Math.max(
    EDGE_SNAP_RADIUS_MIN_PX,
    Math.min(EDGE_SNAP_RADIUS_MAX_PX, naturalShortSide * EDGE_SNAP_RADIUS_FRACTION)
  );
  const r = Math.max(1, Math.round(radiusNatural * scale));
  const cx = Math.round(naturalPt.x * scale);
  const cy = Math.round(naturalPt.y * scale);
  let bestX = cx;
  let bestY = cy;
  let bestVal = -1;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= height) continue;
    const rowLimit = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    for (let dx = -rowLimit; dx <= rowLimit; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= width) continue;
      const v = data[y * width + x];
      if (v > bestVal) {
        bestVal = v;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestVal < EDGE_SNAP_MIN_STRENGTH) return naturalPt;
  return { x: bestX / scale, y: bestY / scale };
}

/** 면이 되려면 최소 세 점은 있어야 한다. 위쪽 한계는 없다 —
 *  'ㄱ'자·'ㄷ'자 싱크대는 모서리가 6~10개라 네 점으로는 딸 수가 없다. */
export const MIN_POLYGON_POINTS = 3;
/** 시작점을 다시 눌러 도형을 닫을 때의 판정 반경(화면 기준 px). */
export const CLOSE_SNAP_SCREEN_PX = 24;

/** 손가락으로 쓸어 그린 경로를 단순화한다. touchmove는 1초에도 수십 번 쏟아지므로
 *  그대로 다 쌓으면 점이 수백 개가 되어(저장·전송 낭비, 다각형 닫을 때도 느려짐)
 *  최소 간격(화면 기준 px, 호출부에서 확대 배율로 나눠 넘긴다)보다 가까운 점은
 *  건너뛴다 — 손이 떨려도 결과 선은 매끈하게 남는다. */
export function simplifyFreehandPath(points: Pt[], minDistance: number): Pt[] {
  if (points.length <= 2) return points;
  const result: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = result[result.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDistance) {
      result.push(points[i]);
    }
  }
  return result;
}

/** 다각형 안쪽을 채우는 빗금(해치) 패턴 타일을 만든다. 손으로 그려 넣은 구역이
 *  "칠해진 면"이 아니라 "표시된 영역"으로 보이도록, 단색 반투명 채우기 대신
 *  제도 도면 느낌의 대각선 빗금을 쓴다 — 특히 겹치는 도형이 많을 때 경계가
 *  더 또렷이 보인다. Konva의 fillPatternImage는 HTMLCanvasElement를 그대로
 *  받으므로 Image 로딩을 기다릴 필요가 없다.
 *
 *  stroke는 선 색(16진 CSS 색상 문자열), tile은 타일 한 변의 길이(px, unit 배율
 *  반영은 호출부에서 fillPatternScale로 한다 — 타일 자체는 항상 같은 해상도로
 *  만들어 둬야 축소해도 선이 안 뭉개진다). */
export function createHatchPattern(stroke: string, tile = 10): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = tile;
  canvas.height = tile;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, tile * 0.12);
  ctx.lineCap = "square";
  // 타일 경계를 넘나드는 대각선 3개(가운데 + 양쪽 모서리 절반)를 그려야
  // 타일을 이어 붙였을 때 빗금이 끊기지 않고 이어진다.
  for (const offset of [-tile, 0, tile]) {
    ctx.beginPath();
    ctx.moveTo(offset, tile);
    ctx.lineTo(offset + tile, 0);
    ctx.stroke();
  }
  return canvas;
}

export function isPolygon(shape: MaskShape): shape is PolygonShape {
  return shape.kind === "polygon";
}

export function isBrush(shape: MaskShape): shape is BrushShape {
  return shape.kind === "brush";
}

/** 도형 하나를 현재 캔버스 경로에 얹는다(채우기는 호출한 쪽에서). 붓 영역은
 *  닫힌 경로 하나로 표현할 수 없으므로(선분 다발) 여기서 다루지 않는다 —
 *  rasterizeMask가 따로 stroke()로 굽는다. */
function tracePath(ctx: CanvasRenderingContext2D, shape: PolygonShape | EllipseShape): void {
  ctx.beginPath();
  if (isPolygon(shape)) {
    shape.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    return;
  }
  ctx.ellipse(shape.x, shape.y, shape.radiusX, shape.radiusY, (shape.rotation * Math.PI) / 180, 0, Math.PI * 2);
}

/** 붓(자석 올가미) 영역 하나를 캔버스에 칠한다 — 획마다 첫 점과 끝 점을 이어
 *  닫힌 윤곽으로 보고 그 안쪽을 채운다(AI가 찾아준 물체 윤곽도 같은 방식으로
 *  들어온다). 점이 하나뿐이거나 둘뿐인 획(톡 찍기)은 닫아도 면이 안 생기므로
 *  작은 원으로 대신 채운다. 여러 획을 그대로 겹쳐 칠해도 전부 불투명 흰색이라
 *  자연히 합쳐진다(따로 합집합 계산이 필요 없다). */
function paintBrush(ctx: CanvasRenderingContext2D, shape: BrushShape): void {
  for (const stroke of shape.strokes) {
    if (stroke.length === 0) continue;
    if (stroke.length < 3) {
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, shape.radiusPx, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    stroke.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }
}

export interface SegmentHit {
  /** 새 점을 끼워 넣을 자리 — points 배열의 이 인덱스 앞에 넣으면 선이 꼬이지 않는다. */
  index: number;
  /** 선분까지의 최단 거리 (사진 원본 픽셀) */
  distance: number;
  /** 선분 위에서 가장 가까운 점 = 새 꼭짓점이 생길 자리 */
  point: Pt;
}

/** 찍은 좌표에서 가장 가까운 변(선분)을 찾는다.
 *
 *  변 AB 위의 어디를 잡았는지는 투영으로 구한다. AP를 AB 방향으로 내적해 AB 길이의
 *  제곱으로 나누면 "AB를 0~1로 봤을 때 몇 지점인가"(t)가 나온다. t를 0~1로 자르는
 *  이유는, 변 바깥쪽을 눌렀을 때 직선이 아니라 '선분'의 끝점까지의 거리를 재야
 *  하기 때문이다(자르지 않으면 변을 한참 지난 허공도 가깝다고 판정된다).
 *
 *  마지막 점과 첫 점을 잇는 변까지 포함한다 — 닫힌 도형이라 그 변도 똑같이 잡을 수
 *  있어야 한다. 이때 삽입 위치는 배열 맨 끝이 된다. */
export function getClosestLineSegment(points: Pt[], p: Pt): SegmentHit | null {
  if (points.length < 2) return null;
  let best: SegmentHit | null = null;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
    const point = { x: a.x + abx * t, y: a.y + aby * t };
    const distance = Math.hypot(p.x - point.x, p.y - point.y);
    if (!best || distance < best.distance) best = { index: i + 1, distance, point };
  }
  return best;
}

/** 도형을 감싸는 사각 범위 — 삭제 버튼을 붙일 자리를 잡는 데 쓴다. */
export function boundsOf(shape: MaskShape): { left: number; top: number; right: number; bottom: number } {
  if (isPolygon(shape)) {
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }
  if (isBrush(shape)) {
    const pts = shape.strokes.flat();
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const r = shape.radiusPx;
    return {
      left: Math.min(...xs) - r,
      top: Math.min(...ys) - r,
      right: Math.max(...xs) + r,
      bottom: Math.max(...ys) + r,
    };
  }
  return {
    left: shape.x - shape.radiusX,
    top: shape.y - shape.radiusY,
    right: shape.x + shape.radiusX,
    bottom: shape.y + shape.radiusY,
  };
}

/** 도형 한 개의 중심 — 라벨을 띄울 자리를 잡는 데 쓴다. */
export function shapeCenter(shape: MaskShape): Pt {
  if (isPolygon(shape)) {
    const n = shape.points.length || 1;
    return {
      x: shape.points.reduce((s, p) => s + p.x, 0) / n,
      y: shape.points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  if (isBrush(shape)) {
    const pts = shape.strokes.flat();
    const n = pts.length || 1;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: shape.x, y: shape.y };
}

export interface RasterizedMask {
  /** 흰색 = 시공할 자리, 검정 = 건드리지 말 자리. 사진 원본 해상도. */
  maskDataUrl: string;
  /** 라벨 위치 — 사진 크기 대비 0~1 비율. */
  labelAt: Pt;
}

/** 도형들을 백엔드가 그대로 쓸 수 있는 하드 마스크 PNG로 굽는다.
 *
 *  캔버스는 도형을 채울 때 가장자리를 부드럽게(안티앨리어싱) 칠해 회색 픽셀을 남긴다.
 *  그 회색은 인페인팅에서 "반쯤 시공된" 띠가 되어 마스크 밖으로 색이 번지는 원인이다.
 *  그래서 구운 뒤 임계값으로 잘라 완전한 흰색/검정 두 값만 남긴다 — 도형의 꺾인
 *  모서리가 흐려지지 않고 칼날처럼 유지된다. */
export function rasterizeMask(shapes: MaskShape[], width: number, height: number): RasterizedMask | null {
  if (shapes.length === 0 || width <= 0 || height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  for (const shape of shapes) {
    if (isPolygon(shape) && shape.points.length < MIN_POLYGON_POINTS) continue;
    if (isBrush(shape)) {
      paintBrush(ctx, shape);
      continue;
    }
    tracePath(ctx, shape);
    ctx.fill();
  }

  // 임계값으로 자르면서 같은 패스에서 무게중심(라벨 자리)까지 구한다.
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const on = data[i] > 127 ? 255 : 0;
    data[i] = on;
    data[i + 1] = on;
    data[i + 2] = on;
    data[i + 3] = 255;
    if (on) {
      const px = (i / 4) % width;
      sumX += px;
      sumY += (i / 4 - px) / width;
      count++;
    }
  }
  if (count === 0) return null;
  ctx.putImageData(image, 0, 0);

  return {
    maskDataUrl: canvas.toDataURL("image/png"),
    labelAt: { x: sumX / count / width, y: sumY / count / height },
  };
}
