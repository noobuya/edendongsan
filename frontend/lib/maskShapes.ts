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

export type Tool = "polygon" | "ellipse" | "select";

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

export type MaskShape = PolygonShape | EllipseShape;

/** 면이 되려면 최소 세 점은 있어야 한다. 위쪽 한계는 없다 —
 *  'ㄱ'자·'ㄷ'자 싱크대는 모서리가 6~10개라 네 점으로는 딸 수가 없다. */
export const MIN_POLYGON_POINTS = 3;
/** 시작점을 다시 눌러 도형을 닫을 때의 판정 반경(화면 기준 px). */
export const CLOSE_SNAP_SCREEN_PX = 24;

export function isPolygon(shape: MaskShape): shape is PolygonShape {
  return shape.kind === "polygon";
}

/** 도형 하나를 현재 캔버스 경로에 얹는다(채우기는 호출한 쪽에서). */
function tracePath(ctx: CanvasRenderingContext2D, shape: MaskShape): void {
  ctx.beginPath();
  if (isPolygon(shape)) {
    shape.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    return;
  }
  ctx.ellipse(shape.x, shape.y, shape.radiusX, shape.radiusY, (shape.rotation * Math.PI) / 180, 0, Math.PI * 2);
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
  return {
    left: shape.x - shape.radiusX,
    top: shape.y - shape.radiusY,
    right: shape.x + shape.radiusX,
    bottom: shape.y + shape.radiusY,
  };
}

/** 도형 한 개의 중심 — 라벨을 띄울 자리를 잡는 데 쓴다. */
export function shapeCenter(shape: MaskShape): Pt {
  if (!isPolygon(shape)) return { x: shape.x, y: shape.y };
  const n = shape.points.length || 1;
  return {
    x: shape.points.reduce((s, p) => s + p.x, 0) / n,
    y: shape.points.reduce((s, p) => s + p.y, 0) / n,
  };
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
  for (const shape of shapes) {
    if (isPolygon(shape) && shape.points.length < MIN_POLYGON_POINTS) continue;
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
