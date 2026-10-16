"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import type Konva from "konva";
import { Circle, Ellipse, Image as KonvaImage, Layer, Line, Stage, Transformer } from "react-konva";
import {
  BRUSH_RADIUS_SCREEN_PX,
  DRAW_LAYER_CLASS,
  MIN_POLYGON_POINTS,
  computeEdgeMap,
  createHatchPattern,
  getClosestLineSegment,
  isBrush,
  isPolygon,
  simplifyFreehandPath,
  snapToEdge,
  type EdgeMap,
  type MaskShape,
  type PolygonShape,
  type Pt,
  type Tool,
} from "@/lib/maskShapes";

/* 모든 치수는 "화면에서 보이는 px"이다. 레이어에 사진 배율이 걸려 있고 확대까지
 * 들어가므로, 그릴 때마다 unit(= 1/(사진배율 × 확대배율))을 곱해 화면상 크기를
 * 일정하게 유지한다. 안 그러면 확대할수록 핸들이 같이 커져 정작 시공면을 가린다. */

/** 꼭짓점 점의 반지름. S펜 사용자는 점 자체가 크면 맞출 자리가 가려진다 —
 *  보이는 크기는 최소로 하고, 아래 HIT_AREA_PX로 잡는 범위만 넉넉히 준다. */
const ANCHOR_RADIUS_PX = 4;
const ANCHOR_STROKE_PX = 1;
/** 눈에 보이지 않는 터치 영역. 점은 4px이어도 20px 안쪽이면 잡힌다. */
const HIT_AREA_PX = 20;
/** 변을 잡은 것으로 볼 거리. 이 안쪽을 누르면 그 자리에 꼭짓점이 생긴다. */
const EDGE_GRAB_PX = 10;
/** 타원 변형 박스 — 날렵하게. */
const TR_ANCHOR_PX = 6;
const TR_ANCHOR_RADIUS_PX = 3;
const TR_BORDER_PX = 1;
/** 손가락으로 쓸어 그릴 때 점을 찍는 최소 간격(화면 기준 px). 너무 촘촘하면
 *  점이 수백 개씩 쌓이고, 너무 성기면 곡선이 각져 보인다. */
const FREEHAND_MIN_DIST_PX = 6;
/** 빗금 무늬의 선 색 — 선택 여부와 같은 인디고 계열로 맞춘다. */
const HATCH_STROKE = "rgba(79, 70, 229, 0.55)";
const HATCH_STROKE_SELECTED = "rgba(79, 70, 229, 0.8)";

export interface CommittedLayer {
  shapes: MaskShape[];
  stroke: string;
  fill: string;
}

interface Props {
  /** 배경으로 깔 현장 사진. 캔버스 안에 함께 그려서 사진과 도형이 한 덩어리가 된다. */
  photo: HTMLImageElement | null;
  /** 사진 원본 픽셀 크기 */
  naturalWidth: number;
  naturalHeight: number;
  /** 화면에 그려진 사진의 크기(CSS px) */
  displayWidth: number;
  displayHeight: number;
  /** 사진 원본 픽셀 → 화면 px 배율 */
  displayScale: number;
  /** 확대/축소 배율 (핸들 크기를 일정하게 유지하는 데 쓴다) */
  viewScale: number;
  shapes: MaskShape[];
  draftPoints: Pt[];
  committed: CommittedLayer[];
  tool: Tool;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** 빈 곳을 탭했을 때 — 좌표는 사진 원본 픽셀 */
  onStageTap: (point: Pt) => void;
  onShapeChange: (shape: MaskShape) => void;
  /** 시작점을 다시 눌러 다각형을 닫을 때 */
  onCloseDraft: () => void;
  /** 지금 칠하고 있는 영역에서, 이미 손을 뗀 이전 획들(사진 원본 픽셀). 다음 획을
   *  더 그으면 여기 쌓인 것 위에 더해져 보여야 하므로 그대로 넘겨받아 같이 그린다. */
  brushStrokes: Pt[][];
  /** 붓으로 한 획을 긋고 손을 뗀 순간 올라온다 — 그 한 획만. 점이 너무 적으면
   *  (실수로 살짝 스친 경우) 아예 안 불린다. 여러 획을 모아 한 영역으로 확정하는
   *  것은 ManualMaskStage의 몫이다(획마다 다시 칠할 수 있어야 하므로 여기서 닫지 않는다). */
  onBrushStrokeComplete: (stroke: Pt[]) => void;
}

/** 도형을 만들고 다듬는 벡터 편집 레이어 (react-konva).
 *
 *  Konva 스테이지는 사진 위에 정확히 겹쳐 놓고, 레이어 전체에 displayScale을 걸어
 *  도형 좌표를 "사진 원본 픽셀"로 다룬다. 그래야 화면 크기가 달라져도(폰을 접었다
 *  펴도) 저장된 도형이 그대로 맞는다.
 *
 *  이 파일은 ManualMaskStage에서 ssr:false로 동적 로드된다 — Konva는 브라우저
 *  캔버스를 전제로 만들어져 서버 렌더링 단계에 들어가면 안 된다. */
export default function ShapeCanvas({
  photo,
  naturalWidth,
  naturalHeight,
  displayWidth,
  displayHeight,
  displayScale,
  viewScale,
  shapes,
  draftPoints,
  committed,
  tool,
  selectedId,
  onSelect,
  onStageTap,
  onShapeChange,
  onCloseDraft,
  brushStrokes,
  onBrushStrokeComplete,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const ellipseRefs = useRef(new Map<number, Konva.Ellipse>());
  // 두 손가락(확대) 중에 찍히는 탭을 무시하기 위한 표시. 확대하다 엉뚱한 꼭짓점이
  // 찍히면 현장에서 다시 지워야 해서 성가시다.
  const multiTouchRef = useRef(false);

  /* [자석 올가미] 사진의 가장자리 세기 지도 — 사진이 바뀔 때 한 번만 계산해 둔다.
   *  매 touchmove마다 새로 계산하면(사진 전체를 훑어야 해서) 느리다. 계산 자체는
   *  수십~백여 ms 걸릴 수 있어 useEffect에서 비동기로(다음 틱에) 돌린다 — 사진이
   *  막 바뀐 순간 메인 스레드를 막아 화면이 멈춘 것처럼 보이는 걸 피한다. */
  const edgeMapRef = useRef<EdgeMap | null>(null);
  useEffect(() => {
    edgeMapRef.current = null;
    if (!photo || naturalWidth <= 0 || naturalHeight <= 0) return;
    const id = window.setTimeout(() => {
      edgeMapRef.current = computeEdgeMap(photo, naturalWidth, naturalHeight);
    }, 0);
    return () => window.clearTimeout(id);
  }, [photo, naturalWidth, naturalHeight]);

  /* 지금 긋고 있는 "한 획"의 경로(사진 원본 픽셀). 이미 그은 획들은 brushStrokes로
   * 부모가 들고 있다가 그대로 다시 내려준다 — 덜 칠한 부분을 다시 그으면 그 위에
   * 더해지는 것도 그래서 가능하다(갤럭시 AI 사진편집의 "지울 영역 칠하기"와 같은
   * 방식으로 바꿔 달라는 요청).
   *
   *  [왜 React state가 아니라 ref로 들고 있는가 — "손꼭지점을 따라 늘어나는 것처럼
   *   보인다" 신고의 원인]
   *  처음엔 이 경로를 useState로 들고 있었다. touchmove는 1초에 수십 번 쏟아지는데,
   *  매번 setState를 부르면 그때마다 ShapeCanvas 전체가 리렌더되고(이미 그려둔
   *  다각형·빗금 패턴까지 포함) Konva가 캔버스를 통째로 다시 그린다. 개발 PC에서는
   *  안 느껴질 정도로 빨라도, 현장에서 쓰는 중저가 안드로이드 기기에서는 이 리렌더가
   *  밀려서 브라우저가 중간 touchmove 샘플들을 건너뛰고 듬성듬성 전달한다 — 그 결과
   *  손가락을 매끄럽게 움직여도 선은 몇 개의 점을 직선으로 이은 것처럼 뚝뚝 끊겨
   *  보인다.
   *
   *  고친 방식: 그리는 동안의 점은 ref 배열에만 쌓고, 미리보기 선은 Konva 노드를
   *  직접 찾아 points()를 명령형으로 갱신한 뒤 batchDraw()만 부른다 — 리액트
   *  리렌더를 한 번도 거치지 않으므로 touchmove가 아무리 빨리 와도 선이 밀리지
   *  않는다. 손을 뗀 순간에만 이 배열을 정리해서 onBrushStrokeComplete로 한 획만
   *  올린다(그때는 리렌더가 한 번 일어나도 괜찮다 — 이미 다 그린 뒤니까). */
  const brushPathRef = useRef<Pt[]>([]);
  const brushLiveLineRef = useRef<Konva.Line>(null);
  const brushDrawingRef = useRef(false);

  function setBrushLivePoints(points: Pt[]) {
    const line = brushLiveLineRef.current;
    if (!line) return;
    line.points(points.flatMap((p) => [p.x, p.y]));
    line.getLayer()?.batchDraw();
  }
  // 빗금 타일은 한 번만 만들어 두고 계속 재사용한다(Canvas 생성 비용을 매
  // 렌더마다 치르지 않도록) — 색만 다른 두 장(기본/선택됨).
  // Konva는 fillPatternImage로 HTMLCanvasElement도 실제로 받아들이지만(런타임
  // GetSet 타입에는 있음), react-konva의 JSX 속성 타입은 HTMLImageElement로만
  // 좁게 선언돼 있다 — 라이브러리 타입 선언의 불일치라 단언으로 맞춘다.
  const hatchPattern = useMemo(() => createHatchPattern(HATCH_STROKE) as unknown as HTMLImageElement, []);
  const hatchPatternSelected = useMemo(
    () => createHatchPattern(HATCH_STROKE_SELECTED) as unknown as HTMLImageElement,
    []
  );

  // 화면 기준으로 일정한 크기를 유지하려면 레이어 배율만큼 나눠야 한다.
  const unit = 1 / (displayScale * viewScale || 1);
  const anchorRadius = ANCHOR_RADIUS_PX * unit;
  // 변을 눌러 새로 만든 꼭짓점을, 손을 떼지 않은 채로 바로 끌 수 있게 하기 위한 것.
  const anchorRefs = useRef(new Map<string, Konva.Circle>());
  const pendingDragRef = useRef<string | null>(null);

  /** [변을 잡아 당기기 — 왜 startDrag를 강제로 부르나]
   *  변을 누른 그 순간에는 새 꼭짓점이 아직 존재하지 않는다. 상태를 바꿔 점을 끼워
   *  넣어도, 이미 손가락은 눌려 있는 상태라 새로 그려진 Circle에는 드래그가 걸리지
   *  않는다(눌리는 순간에 없었으니까). 그래서 렌더가 끝난 직후 그 노드를 찾아
   *  startDrag()를 직접 호출해 드래그를 이어 붙인다 — 사용자 입장에서는 변을 잡아
   *  고무줄처럼 당기는 한 동작으로 보인다. */
  useEffect(() => {
    const key = pendingDragRef.current;
    if (!key) return;
    const node = anchorRefs.current.get(key);
    if (!node) return;
    pendingDragRef.current = null;
    node.startDrag();
  });

  function setCursor(value: string) {
    const container = stageRef.current?.container();
    if (container) container.style.cursor = value;
  }

  /** 변 위를 눌렀을 때: 그 자리에 꼭짓점을 끼워 넣고 곧바로 끌리게 한다. */
  function grabEdge(shape: PolygonShape, e: Konva.KonvaEventObject<PointerEvent>) {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!stage || !pos) return;
    const hit = getClosestLineSegment(shape.points, {
      x: pos.x / displayScale,
      y: pos.y / displayScale,
    });
    if (!hit || hit.distance > EDGE_GRAB_PX * unit) return;

    e.cancelBubble = true;
    const points = shape.points.slice();
    points.splice(hit.index, 0, hit.point);
    pendingDragRef.current = `${shape.id}-${hit.index}`;
    onShapeChange({ ...shape, points });
  }

  // Konva가 만든 캔버스에 패닝 제외 클래스를 붙인다 (위 DRAW_LAYER_CLASS 주석 참고).
  useEffect(() => {
    const content = stageRef.current?.content;
    if (!content) return;
    content.querySelectorAll("canvas").forEach((c) => c.classList.add(DRAW_LAYER_CLASS));
  }, [displayWidth, displayHeight]);

  // 선택된 타원에 4방향 변형 핸들을 붙인다.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId !== null ? ellipseRefs.current.get(selectedId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapes, tool]);

  /** 가장자리 지도가 준비돼 있으면 그 위로 점을 당겨 붙인다. 아직 계산 중이면
   *  (사진을 막 불러온 직후) 손가락 위치를 그대로 쓴다 — 자석 효과만 빠지고
   *  그리기 자체는 끊기지 않는다. */
  function snapIfPossible(pt: Pt): Pt {
    const map = edgeMapRef.current;
    if (!map) return pt;
    return snapToEdge(map, pt, Math.min(naturalWidth, naturalHeight));
  }

  function handleStagePointer(e: Konva.KonvaEventObject<PointerEvent | TouchEvent>) {
    const touches = (e.evt as TouchEvent).touches;
    if (touches && touches.length > 1) {
      multiTouchRef.current = true;
      // 붓으로 칠하던 중에 두 번째 손가락이 닿으면(확대하려는 의도) 지금 긋고
      // 있던 한 획만 버린다 — 이미 손을 뗐던 이전 획들(brushStrokes)은 그대로
      // 남아 있으니 다시 칠하면 된다.
      if (brushDrawingRef.current) {
        brushDrawingRef.current = false;
        brushPathRef.current = [];
        setBrushLivePoints([]);
      }
      return;
    }
    if (tool !== "freehand") return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!stage || !pos) return;
    brushDrawingRef.current = true;
    const start = snapIfPossible({ x: pos.x / displayScale, y: pos.y / displayScale });
    brushPathRef.current = [start];
    setBrushLivePoints(brushPathRef.current);
  }

  /** 손가락이 움직이는 동안 지금 긋는 획에 점을 더한다 — 자석(snapIfPossible)으로
   *  사진의 실제 가장자리에 당겨 붙인 뒤, 최소 간격보다 가까우면 건너뛴다
   *  (simplifyFreehandPath와 같은 기준, 그리는 중에는 매번 배열 전체를 다시 훑을
   *  필요 없이 마지막 점과만 비교하면 된다). ref만 바꾸고 Konva 노드를 직접
   *  갱신한다 — setState를 안 거치므로 리렌더가 없다(위 brushPathRef 주석 참고). */
  function handleBrushMove() {
    if (tool !== "freehand" || !brushDrawingRef.current || multiTouchRef.current) return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!stage || !pos) return;
    const next = snapIfPossible({ x: pos.x / displayScale, y: pos.y / displayScale });
    const path = brushPathRef.current;
    const last = path[path.length - 1];
    if (last && Math.hypot(next.x - last.x, next.y - last.y) < FREEHAND_MIN_DIST_PX * unit) return;
    path.push(next);
    setBrushLivePoints(path);
  }

  /** 손을 뗀 순간 지금 그은 한 획을 확정해 부모로 올린다. 톡 찍기(점 하나)도
   *  유효한 획으로 본다 — 작은 모서리를 콕 찍어 더하는 용도로 쓸 수 있어야
   *  한다. 다각형처럼 "면이 되려면 세 점 이상"이라는 제약이 없다. */
  function handleBrushUp() {
    if (tool !== "freehand" || !brushDrawingRef.current) return;
    brushDrawingRef.current = false;
    const simplified = simplifyFreehandPath(brushPathRef.current, FREEHAND_MIN_DIST_PX * unit);
    brushPathRef.current = [];
    setBrushLivePoints([]);
    if (simplified.length >= 1) onBrushStrokeComplete(simplified);
  }

  /** [왜 onClick/onTap이 아니라 onPointerClick인가]
   *  Konva는 같은 동작을 세 갈래(mouse/touch/pointer)로 모두 쏜다. 손가락으로 한 번
   *  탭하면 touchend에서 tap이, 브라우저가 뒤이어 내보내는 호환용 마우스 이벤트에서
   *  click이 또 날아온다 — 둘 다 듣고 있었더니 한 번 탭에 꼭짓점이 두 개씩 찍혀서
   *  두 번 만에 사각형이 닫혀버렸다(폰에서만, PC 마우스로는 멀쩡해서 더 헷갈린다).
   *  pointerclick은 마우스든 S펜이든 손가락이든 네이티브 pointerup에서 딱 한 번 뜬다. */
  function handleTap(e: Konva.KonvaEventObject<PointerEvent>) {
    if (multiTouchRef.current) {
      multiTouchRef.current = false;
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    // 도형이나 핸들을 눌렀다면 그쪽 핸들러가 처리한다.
    if (e.target !== stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    onStageTap({ x: pos.x / displayScale, y: pos.y / displayScale });
  }

  return (
    <Stage
      ref={stageRef}
      width={displayWidth}
      height={displayHeight}
      onPointerDown={handleStagePointer}
      onTouchStart={handleStagePointer}
      onPointerMove={handleBrushMove}
      onPointerUp={handleBrushUp}
      onPointerClick={handleTap}
      style={{ touchAction: "none", cursor: tool === "select" ? "default" : "crosshair" }}
    >
      {/* [배경 사진도 캔버스 안에 그린다]
          예전에는 <img>를 캔버스 뒤에 깔아 두 요소를 겹쳐 놓았다. 그러면 둘의 크기를
          맞추는 계산이 따로 돌아가 어긋날 여지가 생기고, 사진이 화면을 못 채우는
          문제도 여기서 나왔다. 이제 사진과 도형이 같은 스테이지 안에 있으므로
          확대/이동이 둘에 똑같이 걸린다 — 어긋나는 것 자체가 불가능하다. */}
      <Layer listening={false}>
        {photo && (
          <KonvaImage
            image={photo}
            width={naturalWidth * displayScale}
            height={naturalHeight * displayScale}
          />
        )}
      </Layer>

      {/* 좌표계를 사진 원본 픽셀로 맞춘다 */}
      <Layer scaleX={displayScale} scaleY={displayScale} listening={false}>
        {/* 이미 자재까지 정해진 영역 — 읽기 전용으로 색만 깔아둔다 */}
        {committed.map((layer, li) =>
          layer.shapes.map((shape) => {
            if (isPolygon(shape)) {
              return (
                <Line
                  key={`c${li}-${shape.id}`}
                  points={shape.points.flatMap((p) => [p.x, p.y])}
                  closed
                  fill={layer.fill}
                  stroke={layer.stroke}
                  strokeWidth={2 * unit}
                />
              );
            }
            if (isBrush(shape)) {
              return (
                <Fragment key={`c${li}-${shape.id}`}>
                  {shape.strokes.map((stroke, si) =>
                    stroke.length < 3 ? (
                      <Circle key={si} x={stroke[0].x} y={stroke[0].y} radius={shape.radiusPx} fill={layer.fill} />
                    ) : (
                      <Line
                        key={si}
                        points={stroke.flatMap((p) => [p.x, p.y])}
                        closed
                        fill={layer.fill}
                        stroke={layer.stroke}
                        strokeWidth={2 * unit}
                      />
                    )
                  )}
                </Fragment>
              );
            }
            return (
              <Ellipse
                key={`c${li}-${shape.id}`}
                x={shape.x}
                y={shape.y}
                radiusX={shape.radiusX}
                radiusY={shape.radiusY}
                rotation={shape.rotation}
                fill={layer.fill}
                stroke={layer.stroke}
                strokeWidth={2 * unit}
              />
            );
          })
        )}
      </Layer>

      <Layer scaleX={displayScale} scaleY={displayScale}>
        {shapes.map((shape) => {
          const selected = shape.id === selectedId;
          const common = {
            fill: selected ? "rgba(99,102,241,0.32)" : "rgba(255,255,255,0.26)",
            stroke: selected ? "#4f46e5" : "#ffffff",
            strokeWidth: (selected ? 2.5 : 2) * unit,
            hitStrokeWidth: HIT_AREA_PX * unit,
            onPointerClick: () => onSelect(shape.id),
          };

          if (isPolygon(shape)) {
            // 면(안쪽)과 변(테두리)을 두 노드로 나눠 그린다.
            //
            // 한 노드로 두면 "변을 잡아 당기기"와 "도형 통째로 옮기기"가 같은
            // pointerdown을 두고 다투게 된다 — Konva의 드래그 시작이 내 핸들러보다
            // 먼저 걸릴 수도, 나중에 걸릴 수도 있어서 그때그때 다르게 동작한다.
            // 위에 얹은 테두리 노드는 draggable이 아니므로 애초에 다툼이 없고,
            // Konva는 늘 맨 위 노드를 먼저 잡으므로 판정이 항상 같다.
            //   테두리를 누르면 -> 그 자리에 꼭짓점이 생기고 바로 끌려온다
            //   안쪽을 누르면   -> 도형이 통째로 움직인다
            return (
              <Fragment key={shape.id}>
                <Line
                  {...common}
                  // 다각형은 단색 대신 빗금으로 채운다 — "칠해진 면"이 아니라
                  // "표시된 구역"으로 보이게 하려는 것. 타원(조명 자리)은
                  // common의 단색 fill을 그대로 쓴다(아래 Ellipse는 override 안 함).
                  fill={undefined}
                  fillPatternImage={selected ? hatchPatternSelected : hatchPattern}
                  fillPatternRepeat="repeat"
                  fillPatternScale={{ x: unit, y: unit }}
                  points={shape.points.flatMap((p) => [p.x, p.y])}
                  closed
                  hitStrokeWidth={0}
                  draggable={tool === "select" && selected}
                  onDragEnd={(e) => {
                    // 통째로 옮긴 만큼을 좌표에 녹이고 노드는 원점으로 되돌린다
                    // (노드 위치와 점 좌표에 이동량이 이중으로 남지 않도록).
                    const dx = e.target.x();
                    const dy = e.target.y();
                    e.target.position({ x: 0, y: 0 });
                    onShapeChange({
                      ...shape,
                      points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                    });
                  }}
                />
                {selected && tool === "select" && (
                  <Line
                    points={shape.points.flatMap((p) => [p.x, p.y])}
                    closed
                    stroke="transparent"
                    strokeWidth={EDGE_GRAB_PX * unit}
                    hitStrokeWidth={EDGE_GRAB_PX * unit}
                    // 반드시 꺼야 한다. Konva는 판정용 캔버스에서 닫힌 도형의 안쪽을
                    // "칠 색이 없어도" 무조건 채운다(Context.HitContext._fill). 그대로
                    // 두면 이 투명한 테두리가 도형 안쪽 전체를 덮어, 밑에 있는
                    // 도형 통째로 옮기기가 영영 눌리지 않는다.
                    fillEnabled={false}
                    onPointerDown={(e) => grabEdge(shape, e)}
                    onMouseEnter={() => setCursor("crosshair")}
                    onMouseLeave={() => setCursor("")}
                  />
                )}
              </Fragment>
            );
          }

          if (isBrush(shape)) {
            // 붓(자석 올가미) 영역은 다각형처럼 꼭짓점을 끌어 고치는 기능이 없다 —
            // 통째로 선택해 삭제하거나, 손그림 도구로 다시 칠해 더하는 것만
            // 지원한다. 탭으로 선택할 수 있도록 각 획에 common의 포인터 핸들러를
            // 그대로 건다. 선택된 획은 같은 빗금이라도 더 진한 쪽으로 바뀐다.
            return (
              <Fragment key={shape.id}>
                {shape.strokes.map((stroke, si) =>
                  stroke.length < 3 ? (
                    <Circle
                      key={si}
                      x={stroke[0].x}
                      y={stroke[0].y}
                      radius={shape.radiusPx}
                      fill={common.fill}
                      onPointerClick={common.onPointerClick}
                    />
                  ) : (
                    <Line
                      key={si}
                      points={stroke.flatMap((p) => [p.x, p.y])}
                      closed
                      fillPatternImage={selected ? hatchPatternSelected : hatchPattern}
                      fillPatternRepeat="repeat"
                      fillPatternScale={{ x: unit, y: unit }}
                      stroke={common.stroke}
                      strokeWidth={common.strokeWidth}
                      onPointerClick={common.onPointerClick}
                    />
                  )
                )}
              </Fragment>
            );
          }

          return (
            <Ellipse
              key={shape.id}
              {...common}
              ref={(node) => {
                if (node) ellipseRefs.current.set(shape.id, node);
                else ellipseRefs.current.delete(shape.id);
              }}
              x={shape.x}
              y={shape.y}
              radiusX={shape.radiusX}
              radiusY={shape.radiusY}
              rotation={shape.rotation}
              draggable={tool === "select" && selected}
              onDragEnd={(e) => onShapeChange({ ...shape, x: e.target.x(), y: e.target.y() })}
              onTransformEnd={(e) => {
                // Transformer는 크기를 scaleX/scaleY로 바꾼다. 그 배율을 반지름에
                // 녹여 넣고 배율을 1로 되돌려야, 다음 변형이나 마스크 굽기에서
                // 배율이 겹쳐 적용되지 않는다.
                const node = e.target as Konva.Ellipse;
                const sx = node.scaleX();
                const sy = node.scaleY();
                node.scaleX(1);
                node.scaleY(1);
                onShapeChange({
                  ...shape,
                  x: node.x(),
                  y: node.y(),
                  radiusX: Math.max(4, node.radiusX() * sx),
                  radiusY: Math.max(4, node.radiusY() * sy),
                  rotation: node.rotation(),
                });
              }}
            />
          );
        })}

        {/* 다각형 꼭짓점 핸들 — 이걸 끌어서 원근에 맞춘다.
            보이는 점은 4px로 아주 작게(시공면을 가리지 않게), 잡히는 범위는 20px로
            넉넉하게. 변을 눌러 갓 생긴 점도 여기로 들어오므로 ref를 등록해 둔다. */}
        {shapes.map((shape) =>
          isPolygon(shape) && shape.id === selectedId
            ? shape.points.map((p, i) => (
                <Circle
                  key={`${shape.id}-${i}`}
                  ref={(node) => {
                    const key = `${shape.id}-${i}`;
                    if (node) anchorRefs.current.set(key, node);
                    else anchorRefs.current.delete(key);
                  }}
                  x={p.x}
                  y={p.y}
                  radius={anchorRadius}
                  fill="#ffffff"
                  stroke="#4f46e5"
                  strokeWidth={ANCHOR_STROKE_PX * unit}
                  hitStrokeWidth={HIT_AREA_PX * unit}
                  draggable
                  onMouseEnter={() => setCursor("grab")}
                  onMouseLeave={() => setCursor("")}
                  onDragMove={(e) => {
                    const next = shape.points.slice();
                    next[i] = { x: e.target.x(), y: e.target.y() };
                    onShapeChange({ ...shape, points: next });
                  }}
                />
              ))
            : null
        )}

        {/* 찍는 중인 다각형 — 점 개수에 제한이 없다. 시작점을 다시 누르면 닫힌다. */}
        {draftPoints.length > 0 && (
          <>
            <Line
              points={draftPoints.flatMap((p) => [p.x, p.y])}
              stroke="#4f46e5"
              strokeWidth={2 * unit}
              dash={[8 * unit, 6 * unit]}
              listening={false}
            />
            {/* 세 점부터는 시작점이 "여기 누르면 닫힘" 표적이 된다 */}
            {draftPoints.length >= MIN_POLYGON_POINTS && (
              <Circle
                x={draftPoints[0].x}
                y={draftPoints[0].y}
                radius={anchorRadius * 1.7}
                stroke="#4f46e5"
                strokeWidth={2 * unit}
                dash={[4 * unit, 4 * unit]}
                listening={false}
              />
            )}
            {draftPoints.map((p, i) => (
              <Circle
                key={`draft-${i}`}
                x={p.x}
                y={p.y}
                radius={anchorRadius * (i === 0 ? 1.3 : 1)}
                fill={i === 0 ? "#4f46e5" : "#ffffff"}
                stroke={i === 0 ? "#ffffff" : "#4f46e5"}
                strokeWidth={ANCHOR_STROKE_PX * unit}
                // 시작점만 탭을 받는다 — 나머지 점은 그 자리에 새 점을 찍을 수
                // 있어야 하므로 이벤트를 가로채면 안 된다.
                listening={i === 0 && draftPoints.length >= MIN_POLYGON_POINTS}
                hitStrokeWidth={HIT_AREA_PX * unit}
                onPointerClick={(e) => {
                  e.cancelBubble = true;
                  onCloseDraft();
                }}
              />
            ))}
          </>
        )}

        {/* [자석 올가미] 손가락이 지나는 자리를 사진의 실제 가장자리에 당겨 붙여
            그린다(snapIfPossible). 테두리는 점선(물체를 "따라 그린" 느낌), 안쪽은
            기존 다각형과 같은 빗금으로 채운다. 이미 손을 뗀 획들(brushStrokes,
            부모가 들고 있다가 그대로 내려줌)을 먼저 그리고, 지금 긋는 중인 한 획을
            그 위에 겹쳐 그린다 — 덜 잡힌 부분을 다시 그으면(또는 AI가 꾹 눌러
            찾아준 윤곽을 더하면) 기존 영역과 겹쳐 보여 하나로 합쳐진 것처럼 보이는
            이유다(실제 기하 합집합 계산은 하지 않는다). */}
        {tool === "freehand" && (
          <>
            {brushStrokes.map((stroke, i) =>
              stroke.length < 3 ? (
                <Circle
                  key={`done-${i}`}
                  x={stroke[0].x}
                  y={stroke[0].y}
                  radius={BRUSH_RADIUS_SCREEN_PX * unit}
                  fill="rgba(79, 70, 229, 0.3)"
                  listening={false}
                />
              ) : (
                <Line
                  key={`done-${i}`}
                  points={stroke.flatMap((p) => [p.x, p.y])}
                  closed
                  fillPatternImage={hatchPatternSelected}
                  fillPatternRepeat="repeat"
                  fillPatternScale={{ x: unit, y: unit }}
                  stroke="#4f46e5"
                  strokeWidth={2 * unit}
                  dash={[7 * unit, 5 * unit]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              )
            )}
            {/* 지금 긋는 중인 한 획. points를 React prop으로 선언하지 않는다 —
                선언하면 이 컴포넌트가 다른 이유로(확대/축소 등) 리렌더될 때마다
                react-konva가 그 선언값으로 덮어써 버려, 긋던 중간에 선이 리셋돼
                버린다. handleBrushMove/Up이 ref로 직접 points()를 불러 채우고,
                React 리렌더는 전혀 거치지 않는다(위 brushPathRef 주석 참고). */}
            <Line
              ref={brushLiveLineRef}
              closed
              fillPatternImage={hatchPatternSelected}
              fillPatternRepeat="repeat"
              fillPatternScale={{ x: unit, y: unit }}
              stroke="#4f46e5"
              strokeWidth={2.5 * unit}
              dash={[7 * unit, 5 * unit]}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          </>
        )}

        {/* 타원 전용 4방향 핸들. 모서리(대각선) 핸들을 빼서 손가락으로도 가로/세로를
            따로 늘릴 수 있게 하고, 천장 원근에 맞추도록 회전은 열어둔다. */}
        <Transformer
          ref={trRef}
          enabledAnchors={["middle-left", "middle-right", "top-center", "bottom-center"]}
          rotateEnabled
          anchorSize={TR_ANCHOR_PX * unit}
          anchorCornerRadius={TR_ANCHOR_RADIUS_PX * unit}
          anchorStroke="#4f46e5"
          anchorFill="#ffffff"
          anchorStrokeWidth={TR_BORDER_PX * unit}
          borderStroke="#4f46e5"
          borderStrokeWidth={TR_BORDER_PX * unit}
          rotateAnchorOffset={26 * unit}
          ignoreStroke
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
        />
      </Layer>
    </Stage>
  );
}
