"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import dynamic from "next/dynamic";
import {
  Check,
  ChevronUp,
  Circle as CircleIcon,
  LassoSelect,
  Maximize2,
  MousePointer2,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { MappedRegion } from "@/types";
import { REGION_COLORS } from "@/lib/workItems";
import {
  BRUSH_RADIUS_SCREEN_PX,
  CLOSE_SNAP_SCREEN_PX,
  DRAW_LAYER_CLASS,
  MIN_POLYGON_POINTS,
  UI_CONTROL_CLASS,
  boundsOf,
  rasterizeMask,
  type MaskShape,
  type Pt,
  type Tool,
} from "@/lib/maskShapes";

// Konva는 브라우저 캔버스를 전제로 동작해 서버 렌더링 단계에 들어가면 안 된다.
// (정적 export 빌드에서도 페이지 HTML을 미리 만들어 보므로 ssr:false가 필요하다.)
const ShapeCanvas = dynamic(() => import("@/components/ShapeCanvas"), { ssr: false });

export interface MaskStageHandle {
  /** 지금 만들어 둔 도형들을 하드 마스크 PNG로 굽는다. 도형이 없으면 null. */
  extractShape: () => { maskDataUrl: string; labelAt: Pt; shapes: MaskShape[] } | null;
  clearShape: () => void;
}

interface Props {
  photoUrl: string;
  regions: MappedRegion[];
  /** 지정 중인 도형이 생기거나 사라질 때 알려준다(우측 패널 안내용). */
  onShapeChange: (hasShape: boolean) => void;
  /** true = 지금 그리는 중이니 사진을 넓게 쓰고 싶다, false = 도형을 다 만들었으니
   *  자재를 고를 패널을 열어달라. 페이지가 패널을 접고 펴는 데 쓴다. */
  onDrawFocus?: (focused: boolean) => void;
  /** 자재 패널이 열려 있는지 — 닫혀 있을 때만 도구 막대에 여는 버튼을 둔다. */
  panelOpen?: boolean;
  onOpenPanel?: () => void;
  /** 패널 안에 끼워 쓸 때. 위쪽 앱 바 자리를 비워둘 필요가 없어 그만큼 사진이 커진다
   *  (전체 화면일 때만 앱 바가 사진 위에 떠 있다). */
  embedded?: boolean;
}

/** 사진 위에 벡터 도형으로 시공 영역을 지정하는 화면.
 *
 *  [구조 — 사진과 드로잉이 절대 어긋나지 않는 이유]
 *  사진 <img> 한 장과 Konva 캔버스를 같은 크기로 정확히 겹쳐 놓고, 그 묶음 전체를
 *  TransformWrapper 안에 넣는다. 확대·이동은 이 묶음에 통째로 걸리므로 사진과 그려둔
 *  선은 언제나 1:1로 맞물린다. 갤러리 앱에서 사진을 확대하는 것과 같은 동작이다.
 *
 *  사진을 감싸는 div는 max-w/max-h만 주어 사진의 실제 비율대로 줄어들게 둔다.
 *  (h-full w-full + object-contain으로 하면 요소 크기와 실제로 그려진 사진 크기가
 *  달라져, 탭한 자리와 도형이 찍히는 자리가 어긋난다.)
 *
 *  [조작]
 *    다각형 : 탭할 때마다 꼭짓점이 계속 추가된다. 점 개수 제한이 없어 'ㄱ'자·'ㄷ'자
 *             싱크대도 딸 수 있다. 시작점을 다시 누르거나 [도형 닫기]로 면을 만든다.
 *    원형   : 탭한 자리에 타원이 생기고, 4방향 핸들로 천장 원근에 맞게 찌그러뜨린다.
 *    편집   : 도형을 탭하면 선택되고, 꼭짓점 핸들과 빨간 삭제 뱃지가 나타난다.
 *    1손가락/S펜 = 도형 조작, 2손가락 = 확대·이동. */
const ManualMaskStage = forwardRef<MaskStageHandle, Props>(function ManualMaskStage(
  { photoUrl, regions, onShapeChange, onDrawFocus, panelOpen = true, onOpenPanel, embedded = false },
  ref
) {
  const areaRef = useRef<HTMLDivElement>(null);
  const shapeIdRef = useRef(1);
  // 사진은 DOM에 붙이지 않고 메모리로만 읽어 Konva 배경 레이어에 그린다.
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<Tool>("polygon");
  const [shapes, setShapes] = useState<MaskShape[]>([]);
  const [draftPoints, setDraftPoints] = useState<Pt[]>([]);
  // 손그림(붓) 도구로 지금 칠하고 있는 영역 — 손을 뗄 때마다 한 획씩 쌓인다.
  // 아직 하나의 BrushShape로 확정되지 않은 상태라 shapes와 별도로 들고 있다가,
  // finishBrush에서 한 번에 묶는다.
  const [brushStrokes, setBrushStrokes] = useState<Pt[][]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewScale, setViewScale] = useState(1);

  useEffect(() => {
    onShapeChange(shapes.length > 0);
  }, [shapes.length, onShapeChange]);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      setPhoto(img);
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = photoUrl;
    return () => {
      img.onload = null;
    };
  }, [photoUrl]);

  // 그림을 그릴 수 있는 영역(도구 막대를 뺀 화면 전체)을 계속 따라간다.
  // 폰을 접었다 펴면 여기가 달라지고, 그때마다 사진을 다시 맞춰야 한다.
  //
  // ResizeObserver와 window resize/orientationchange/visualViewport resize를
  // 전부 걸어 둬도, 삼성 갤럭시 Z 폴드 실기기에서 힌지 상태를 접었다 펴면
  // 이벤트가 하나도 안 걸리고 영역이 접힌 크기로 그대로 남는 게 실제로
  // 재현됐다 — 이 기종(또는 이 WebView)은 폴드 전환을 리사이즈로 안 알려주는
  // 것으로 보인다. 이벤트만으로는 못 믿으므로 0.4초마다 실제 크기를 직접 재서
  // 비교하는 폴링을 최후의 보루로 추가했다.
  //
  // [화면이 가만히 있는데 계속 깜빡이던 버그 — 2026-10-15 수정]
  // 위 신호 5개(ResizeObserver·resize·orientationchange·visualViewport·
  // visibilitychange)를 전부 같은 measure()에 걸어 두면서, measure()가 값이
  // 실제로 바뀌었는지 보지도 않고 매번 setArea({...}) 새 객체를 넣었다. 크기가
  // 1px도 안 바뀌었어도 객체 레퍼런스는 매번 새것이라 리액트가 매번 다시
  // 그렸고, 이 신호들은 모바일에서 화면을 가만히 둬도 수시로(상태바가 살짝
  // 깜빡이거나, 주소창이 미세하게 흔들리거나, visibilitychange가 스치듯
  // 지나가거나) 공짜로 발동한다 — 그 결과가 "화면이 꺼졌다 켜졌다", "스크롤이
  // 됐다 안됐다", "확대한 화면이 도로 작아짐"으로 보였다(캔버스가 매 렌더마다
  // 다시 그려지며 진행 중이던 터치 제스처가 끊겼다). 이제 measure()가 가로/
  // 세로가 "실제로" 달라졌을 때만 setArea를 부른다 — 신호가 아무리 자주
  // 와도 값이 같으면 리액트까지 가지 않는다.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    setArea(last);
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === last.w && h === last.h) return; // 값이 같으면 아무 일도 하지 않는다
      last = { w, h };
      setArea(last);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", measure);
    const poll = window.setInterval(measure, 400);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", measure);
      window.clearInterval(poll);
    };
  }, []);

  // 사진을 영역에 맞춰 최대한 크게 넣는다(잘리지 않게 — 현장 사진은 구석까지 봐야
  // 견적을 뽑을 수 있다). 스테이지 크기가 곧 사진 크기라 안쪽에 여백이 없다.
  const fit = natural && area ? Math.min(area.w / natural.w, area.h / natural.h) : 0;
  const display = natural && fit > 0 ? { w: natural.w * fit, h: natural.h * fit } : null;
  const displayScale = fit || 1;

  function pickTool(next: Tool) {
    setTool(next);
    setSelectedId(null);
    if (next !== "polygon") setDraftPoints([]);
    // 다른 도구로 바꾸면 아직 확정 안 한 붓질은 버린다 — 손그림으로 돌아오면
    // 늘 새로 시작한다(어중간하게 칠하다 만 영역이 남아 헷갈리지 않도록).
    if (next !== "freehand") setBrushStrokes([]);
    // 그리려는 참이면 사진을 넓게 쓴다.
    if (next !== "select") onDrawFocus?.(true);
  }

  function addShape(shape: MaskShape) {
    setShapes((prev) => [...prev, shape]);
    setSelectedId(shape.id);
    // 만들자마자 핸들을 잡을 수 있어야 한다 — 도형을 놓는 것보다 원근을 맞추는
    // 일이 훨씬 오래 걸리기 때문이다.
    // 패널은 일부러 열지 않는다. 한 구역에 도형을 여러 개 그리는 경우가 많은데,
    // 도형을 닫을 때마다 패널이 올라와 사진을 덮으면 다음 도형을 그릴 수가 없다.
    // 자재는 아래 [자재 고르기] 버튼으로 언제든 연다.
    setTool("select");
  }

  /** [상태 갱신 함수 안에서 다른 상태를 바꾸지 않는 이유]
   *  예전에는 setDraftPoints의 갱신 함수 안에서 setShapes를 불렀다. React는 개발
   *  모드에서 갱신 함수를 일부러 두 번 실행해 부작용을 잡아내는데, 그 바람에 도형이
   *  매번 두 개씩 겹쳐 추가됐다. 눈으로는 한 개로 보이지만 삭제를 눌러도 밑에 깔린
   *  쌍둥이가 남아 "삭제가 안 되는" 증상이 됐다. 갱신 함수는 값만 계산해 돌려준다. */
  const closeDraft = useCallback(() => {
    if (draftPoints.length < MIN_POLYGON_POINTS) return;
    const shape: MaskShape = { id: shapeIdRef.current++, kind: "polygon", points: draftPoints };
    setShapes((prev) => [...prev, shape]);
    setDraftPoints([]);
    setSelectedId(shape.id);
    setTool("select");
    // 도형을 다 그렸으니 자재를 고를 패널을 다시 편다 — 타원(조명)과 달리 다각형은
    // 보통 한 구역에 한 번만 그리므로, 여기서 안 열면 화면 맨 아래 작은 [자재 고르기]
    // 버튼을 직접 찾아 눌러야만 다음으로 진행할 수 있었다("선택 후 진행이 안 된다"는
    // 문의의 원인). 여러 도형을 합쳐 한 구역을 만들 때는 패널 위 [접고 사진 보기]로
    // 다시 접고 이어 그리면 된다.
    onDrawFocus?.(false);
  }, [draftPoints, onDrawFocus]);

  /** 손을 뗄 때마다 올라오는 붓질 한 획을 쌓아 둔다. 바로 도형으로 확정하지
   *  않는다 — 덜 칠한 부분이 있으면 그 위에 또 그어 더할 수 있어야 하므로,
   *  확정은 사용자가 [영역 확정]을 누른 순간(finishBrush)에만 한다. */
  const handleBrushStrokeComplete = useCallback((stroke: Pt[]) => {
    setBrushStrokes((prev) => [...prev, stroke]);
  }, []);

  /** 지금까지 칠한 획들을 하나의 붓 영역 도형으로 묶는다. closeDraft와 같은
   *  마무리 동작(선택 상태로 전환 + 자재 패널 열기)을 쓴다 — 칠하는 것도
   *  "구역 하나를 한 번에 정의"하는 동작이라 다각형을 다 그렸을 때와 성격이 같다.
   *  반지름은 지금 화면 배율 기준으로 한 번 고정한다 — 사진 원본 픽셀로 저장해야
   *  나중에 확대 배율이 달라져도(폰을 접었다 펴도) 칠한 굵기가 그대로 보인다. */
  const finishBrush = useCallback(() => {
    if (brushStrokes.length === 0) return;
    const radiusPx = BRUSH_RADIUS_SCREEN_PX / (displayScale * viewScale || 1);
    const shape: MaskShape = { id: shapeIdRef.current++, kind: "brush", strokes: brushStrokes, radiusPx };
    setShapes((prev) => [...prev, shape]);
    setBrushStrokes([]);
    setSelectedId(shape.id);
    setTool("select");
    onDrawFocus?.(false);
  }, [brushStrokes, displayScale, viewScale, onDrawFocus]);

  function handleStageTap(point: Pt) {
    if (tool === "polygon") {
      // 시작점 근처를 다시 누르면 면을 닫는다. 확대 중이면 화면 기준 거리가
      // 사진 기준으로는 더 짧아지므로 배율로 나눠 판정한다.
      if (draftPoints.length >= MIN_POLYGON_POINTS) {
        const snap = CLOSE_SNAP_SCREEN_PX / (displayScale * viewScale || 1);
        const first = draftPoints[0];
        if (Math.hypot(point.x - first.x, point.y - first.y) <= snap) {
          closeDraft();
          return;
        }
      }
      setDraftPoints((prev) => [...prev, point]);
      return;
    }
    if (tool === "ellipse") {
      // 기본 크기는 사진 짧은 변의 1/10 — 조명 기구가 대개 이 정도로 찍힌다.
      const base = natural ? Math.min(natural.w, natural.h) * 0.1 : 60;
      addShape({
        id: shapeIdRef.current++,
        kind: "ellipse",
        x: point.x,
        y: point.y,
        radiusX: base,
        radiusY: base * 0.45, // 천장은 비스듬히 보이므로 처음부터 눌린 타원으로
        rotation: 0,
      });
      return;
    }
    setSelectedId(null);
  }

  function updateShape(shape: MaskShape) {
    setShapes((prev) => prev.map((s) => (s.id === shape.id ? shape : s)));
  }

  function deleteShape(id: number) {
    setShapes((prev) => prev.filter((s) => s.id !== id));
    setSelectedId(null);
  }

  function undo() {
    if (brushStrokes.length > 0) {
      setBrushStrokes((prev) => prev.slice(0, -1));
      return;
    }
    if (draftPoints.length > 0) {
      setDraftPoints((prev) => prev.slice(0, -1));
      return;
    }
    const next = shapes.slice(0, -1);
    setShapes(next);
    setSelectedId(next.length > 0 ? next[next.length - 1].id : null);
  }

  const clearShape = useCallback(() => {
    setShapes([]);
    setDraftPoints([]);
    setBrushStrokes([]);
    setSelectedId(null);
    setTool("polygon");
  }, []);

  useImperativeHandle(ref, () => ({
    clearShape,
    extractShape: () => {
      if (!natural || shapes.length === 0) return null;
      const baked = rasterizeMask(shapes, natural.w, natural.h);
      return baked ? { ...baked, shapes } : null;
    },
  }));

  const canClose = draftPoints.length >= MIN_POLYGON_POINTS;
  const canFinishBrush = tool === "freehand" && brushStrokes.length > 0;
  const hasAnything = shapes.length > 0 || draftPoints.length > 0 || brushStrokes.length > 0;
  const selectedShape = shapes.find((s) => s.id === selectedId) ?? null;

  return (
    /* 펼친 화면(Z Fold)에서는 오른쪽 420px을 자재 패널이 늘 차지하므로, 사진과
       도구 막대를 그 왼쪽 영역 안에 가둔다. 세로 화면에서는 패널이 접혀 있어
       화면 전체를 쓴다.

       [embedded일 때는 이 여백을 주면 안 된다 — "가로 모드에서 사진이 한쪽
       구석에 작게 나온다"의 원인]
       이 오른쪽 여백은 ReeditOverlay/page.tsx의 "전체 화면" 사용처에만 맞는
       가정이다 — 그쪽은 실제로 오른쪽에 자재 패널이 떠 있다. 반면 SectorReedit은
       embedded=true로 이 컴포넌트를 쓰면서 자재 선택을 사진 "아래" 별도 메뉴로
       빼서, 오른쪽에는 애초에 아무 패널도 없다. 그런데도 이 여백이 무조건
       걸려 있어서, 가로 화면에 들어가면 사진이 왼쪽 440px(27.5rem)짜리 좁은
       칸에 눌려 작게 보였다 — 오른쪽 440px은 그냥 빈 채로 버려졌다. */
    <div className={`absolute inset-0 flex flex-col ${embedded ? "" : "foldLandscape:pr-[27.5rem]"}`}>
      {/* 사진 영역 — 화면에서 도구 막대를 뺀 전부를 쓴다.
          위쪽 여백은 떠 있는 앱 바가 사진 맨 위를 가리지 않도록 둔 것이다. */}
      <div className={`relative min-h-0 flex-1 pb-1 ${embedded ? "pt-1" : "pt-[4.5rem]"}`}>
        {/* 여백을 뺀 "진짜 그릴 수 있는 영역"을 따로 재야 한다.
            바깥 div는 clientHeight에 위쪽 여백(앱 바 자리)까지 포함해서,
            그대로 쓰면 사진이 그 여백만큼 커져 화면 밖으로 밀려난다. */}
        <div ref={areaRef} className="h-full w-full">
        <TransformWrapper
          minScale={1}
          maxScale={8}
          limitToBounds
          centerOnInit
          doubleClick={{ disabled: true }}
          /* 라이브러리는 1손가락도 기본이 화면 이동이다. 캔버스 클래스를 제외 목록에
             넣어 캔버스 위에서 시작한 제스처는 패닝으로 넘기지 않는다. 핀치(2손가락)는
             이 검사를 거치지 않으므로 확대/축소는 그대로 동작한다. */
          panning={{
            disabled: false,
            allowLeftClickPan: false,
            excluded: [DRAW_LAYER_CLASS, UI_CONTROL_CLASS],
          }}
          pinch={{ step: 5 }}
          wheel={{ step: 0.15 }}
          onTransform={(_ref, state) => setViewScale(state.scale)}
        >
          {({ resetTransform }) => (
            <>
              <TransformComponent
                wrapperClass="!h-full !w-full"
                contentClass="!h-full !w-full !items-center !justify-center"
              >
                {/* 사진과 도형이 같은 스테이지 안에 있는 상자. 확대는 이 상자에
                    통째로 걸리므로 둘이 어긋날 수가 없다. 상자 크기 = 사진 크기라
                    안쪽에 빈 여백이 없다. */}
                <div
                  className="relative"
                  style={display ? { width: display.w, height: display.h } : undefined}
                >
                  {natural && display && (
                    <div className="absolute inset-0">
                      <ShapeCanvas
                        photo={photo}
                        naturalWidth={natural.w}
                        naturalHeight={natural.h}
                        displayWidth={display.w}
                        displayHeight={display.h}
                        displayScale={displayScale}
                        viewScale={viewScale}
                        shapes={shapes}
                        draftPoints={draftPoints}
                        committed={regions.map((region) => {
                          const color = REGION_COLORS[region.colorIndex % REGION_COLORS.length];
                          return { shapes: region.shapes ?? [], stroke: color.stroke, fill: color.fill };
                        })}
                        tool={tool}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onStageTap={handleStageTap}
                        onShapeChange={updateShape}
                        onCloseDraft={closeDraft}
                        brushStrokes={brushStrokes}
                        onBrushStrokeComplete={handleBrushStrokeComplete}
                      />
                    </div>
                  )}

                  {/* 선택한 도형의 삭제 버튼 — 도형 오른쪽 위에 붙는다.
                      사진과 같은 상자 안에 있어 확대/이동을 함께 따라가고,
                      배율의 역수로 되돌려 손가락 크기는 언제나 그대로 유지한다.
                      (Konva 도형으로 그렸더니 확대 상태에 따라 탭이 빗나갔다.) */}
                  {natural && selectedShape && (
                    <button
                      type="button"
                      aria-label="이 도형 삭제"
                      onClick={() => deleteShape(selectedShape.id)}
                      className="mask-ui-control absolute flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_4px_14px_rgba(0,0,0,0.35)] ring-2 ring-white transition-transform active:scale-90"
                      style={{
                        left: `${(boundsOf(selectedShape).right / natural.w) * 100}%`,
                        top: `${(boundsOf(selectedShape).top / natural.h) * 100}%`,
                        // 도형 오른쪽 위 "바깥"으로 완전히 빼낸다. 꼭짓점 위에
                        // 겹쳐 두었더니 그 꼭짓점을 잡으려는 손이 전부 삭제 버튼에
                        // 막혀서, 모서리 하나를 아예 못 옮겼다.
                        transform: `translate(25%, -115%) scale(${1 / viewScale})`,
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}

                  {/* 확정된 영역의 자재 이름 */}
                  {regions.map((region) => {
                    const color = REGION_COLORS[region.colorIndex % REGION_COLORS.length];
                    return (
                      <span
                        key={region.id}
                        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow-lg"
                        style={{
                          left: `${region.labelAt.x * 100}%`,
                          top: `${region.labelAt.y * 100}%`,
                          backgroundColor: color.stroke,
                        }}
                      >
                        {region.optionLabel}
                        {region.customDesign && (
                          <span className="font-normal opacity-85"> · {region.customDesign}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </TransformComponent>

              {viewScale > 1.01 && (
                <button
                  type="button"
                  onClick={() => resetTransform()}
                  className="mask-ui-control glass-pill absolute right-3 top-[5rem] flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-transform active:scale-95"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  {viewScale.toFixed(1)}× 원래대로
                </button>
              )}
            </>
          )}
        </TransformWrapper>
        </div>
      </div>

      {/* 도구 막대 — 사진 위에 겹치지 않고 아래에 따로 자리를 차지한다.
          예전에는 사진 위에 떠 있어서, 좁은 세로 화면에서 모서리를 탭하면 버튼이
          대신 눌리는 일이 잦았다(실제로 '전체 지우기'가 눌려 작업이 날아갔다). */}
      <div className="shrink-0 px-3 pb-3">
        <div className="glass-panel flex items-center gap-1 rounded-2xl p-1.5">
          <ToolButton active={tool === "polygon"} onClick={() => pickTool("polygon")}
                      icon={<Square className="h-4 w-4" />} label="다각형" />
          <ToolButton active={tool === "freehand"} onClick={() => pickTool("freehand")}
                      icon={<LassoSelect className="h-4 w-4" />} label="손그림" />
          <ToolButton active={tool === "ellipse"} onClick={() => pickTool("ellipse")}
                      icon={<CircleIcon className="h-4 w-4" />} label="원형" />
          <ToolButton active={tool === "select"} onClick={() => pickTool("select")}
                      icon={<MousePointer2 className="h-4 w-4" />} label="편집" />

          <span className="mx-1 min-w-0 flex-1 truncate text-center text-[11px] font-medium text-indigo-600">
            {hintFor(tool, draftPoints.length, shapes.length, brushStrokes.length)}
          </span>

          {canClose && (
            <button
              type="button"
              onClick={closeDraft}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_6px_20px_rgba(79,70,229,0.4)] transition-transform active:scale-95"
            >
              <Check className="h-3.5 w-3.5" />
              도형 닫기
            </button>
          )}
          {canFinishBrush && (
            <button
              type="button"
              onClick={finishBrush}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_6px_20px_rgba(79,70,229,0.4)] transition-transform active:scale-95"
            >
              <Check className="h-3.5 w-3.5" />
              영역 확정
            </button>
          )}
          {hasAnything && (
            <>
              <button
                type="button"
                onClick={undo}
                aria-label="되돌리기"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition-transform active:scale-90"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={clearShape}
                aria-label="전체 지우기"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-red-500 transition-transform active:scale-90"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* 자재 패널을 여는 버튼은 도구 막대 아래에 둔다 — 패널이 사진을 덮고 있으면
            정작 그릴 곳이 안 보이므로, 그리는 동안에는 패널을 완전히 내려둔다. */}
        {!panelOpen && (
          <button
            type="button"
            onClick={onOpenPanel}
            className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-[13px] font-semibold text-white shadow-[0_8px_24px_rgba(79,70,229,0.4)] transition-transform active:scale-[0.98]"
          >
            <ChevronUp className="h-4 w-4" />
            {shapes.length > 0 ? "자재 고르기" : "시공 항목 · 자재"}
            {regions.length > 0 && (
              <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px]">{regions.length}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
});

export default ManualMaskStage;

/** 안내문은 짧게 — 도구 막대 가운데 한 줄에 들어가야 한다. */
function hintFor(tool: Tool, draftCount: number, shapeCount: number, brushStrokeCount: number): string {
  if (tool === "polygon") {
    if (draftCount === 0) return "모서리를 차례로 탭하세요";
    if (draftCount < MIN_POLYGON_POINTS) return `${draftCount}점 · 계속 탭하세요`;
    return `${draftCount}점 · 시작점을 눌러 닫기`;
  }
  if (tool === "freehand") {
    if (brushStrokeCount === 0) return "손가락으로 칠해서 표시하세요";
    return "덜 칠한 곳은 다시 칠해서 더하세요 · 다 됐으면 확정";
  }
  if (tool === "ellipse") return "조명 자리를 탭하세요";
  if (shapeCount === 0) return "도구를 고르세요";
  return "도형을 탭해 수정·삭제";
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-2 text-[11px] font-semibold transition-all active:scale-95 ${
        active ? "bg-indigo-600 text-white shadow-[0_4px_14px_rgba(79,70,229,0.4)]" : "text-slate-600"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
