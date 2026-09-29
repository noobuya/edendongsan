"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import ManualMaskStage, { type MaskStageHandle } from "@/components/ManualMaskStage";
import MaterialPicker from "@/components/MaterialPicker";
import { fetchAssetObjectUrl, remaskJob } from "@/lib/api";
import { taskTypeOf } from "@/lib/workItems";
import type { MappedRegion, WorkItemId } from "@/types";

interface Props {
  jobId: string;
  /** 지금 화면에 떠 있는 시공 후 사진. 이 사진 위에 구역을 다시 잡는다. */
  imageUrl: string;
  /** 서버가 이미 다른 편집을 돌리는 중인지 */
  busy: boolean;
  onSubmitted: () => void;
  /** 색상 스와치·문구 입력 같은 기존 편집 도구. 캔버스 위가 아니라 아래 메뉴 안에
   *  넣어야 한다 — 위에 쌓으면 편집기가 화면 밖으로 밀려나 정작 캔버스를 못 쓴다. */
  extras?: React.ReactNode;
}

/** 3단계 '구역 부분 편집' — 2단계와 같은 마스킹 엔진을 그대로 쓴다.
 *
 *  [레이아웃을 위/아래로 못 박은 이유]
 *  캔버스와 조작 메뉴가 한 스크롤 안에 섞여 있으면, 화면을 올리려고 사진 위에서
 *  손가락을 끄는 순간 그게 "그리기"로 먹혀 점만 찍히고 화면은 꼼짝하지 않는다.
 *  캔버스 높이를 고정해 그 안은 오직 그리기(1손가락)와 확대(2손가락)만 받고,
 *  스크롤은 아래 메뉴 영역에서만 일어나게 갈라 놓는다. */
export default function SectorReedit({ jobId, imageUrl, busy, onSubmitted, extras }: Props) {
  const maskStageRef = useRef<MaskStageHandle>(null);
  const regionIdRef = useRef(1);
  const [regions, setRegions] = useState<MappedRegion[]>([]);
  const [hasShape, setHasShape] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 사진에 새길 문구/그림. 구역마다 따로 받지 않고 한 번에 받아, 보낼 때
  // 각 구역 프롬프트 끝에 붙인다.
  const [overlayText, setOverlayText] = useState("");
  // 사진 비율. 상자를 이 비율로 잡아야 남색 여백 없이 사진이 꽉 찬다.
  const [aspect, setAspect] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 사진 높이 + 도구 막대(56px). 화면 높이의 70%는 넘지 않게 막는다.
  const boxHeight = Math.min(
    Math.round(boxWidth / (aspect ?? 4 / 3)) + 56,
    typeof window !== "undefined" ? Math.round(window.innerHeight * 0.7) : 600
  );
  // 사진은 blob으로 받아 넘긴다. 결과 사진 주소는 ngrok을 거치는데 그 주소를
  // new Image()에 그대로 물리면 경고 페이지가 내려와 로딩이 실패하고,
  // 편집기가 "아무것도 없는 화면"으로 뜬다(AssetImage가 있는 이유와 같다).
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchAssetObjectUrl(imageUrl)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setLocalUrl(url);
        const probe = new window.Image();
        probe.onload = () => setAspect(probe.naturalWidth / probe.naturalHeight);
        probe.src = url;
      })
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : "시공 후 사진을 불러오지 못했습니다.")
      );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl]);

  const commitRegion = useCallback(
    (
      category: WorkItemId,
      option: string,
      optionLabel: string,
      customDesign: string,
      doorMaterial?: "wood" | "steel"
    ) => {
      const shape = maskStageRef.current?.extractShape();
      if (!shape) return;
      setRegions((prev) => [
        ...prev,
        {
          id: regionIdRef.current++,
          maskDataUrl: shape.maskDataUrl,
          labelAt: shape.labelAt,
          shapes: shape.shapes,
          category,
          option,
          optionLabel,
          taskType: taskTypeOf(category),
          prompt: optionLabel,
          customDesign: customDesign || undefined,
          doorMaterial,
          colorIndex: prev.length,
        },
      ]);
      maskStageRef.current?.clearShape();
    },
    []
  );

  async function handleApply() {
    if (regions.length === 0 || submitting || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      // 적어둔 문구가 있으면 모든 구역에 함께 실어 보낸다 — 버튼 한 번에
      // 구역 변경과 문구가 같이 반영된다.
      const text = overlayText.trim();
      const payload = text
        ? regions.map((r) => ({
            ...r,
            customDesign: r.customDesign
              ? `${r.customDesign}, with text "${text}" neatly applied`
              : `with text "${text}" neatly applied`,
          }))
        : regions;
      await remaskJob(jobId, payload);
      setRegions([]);
      setOverlayText("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "다시 적용에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    /* 편집기 전체를 화면 한 장에 꼭 맞춘다.
       바깥 패널까지 스크롤되면, 화면을 올리려고 사진을 끄는 순간 그게 그리기로 먹혀
       점만 찍히고 화면은 꼼짝하지 않는다(원래 버그). 여기서 스크롤이 일어나는 곳은
       아래 메뉴 한 군데뿐이다. */
    <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col bg-white">
      {/* --- 위: 캔버스 ---
          사진 비율에 맞춰 이 영역을 꽉 채운다. 예전에는 남색 여백이 화면을 반 넘게
          차지하고 사진만 가운데 조그맣게 떠 있었다. */}
      <div
        className="relative w-full shrink-0 bg-slate-800"
        // 높이를 CSS로 계산하지 않고 실제 패널 폭에서 구한다. 예전에는 100vw를
        // 썼는데, PC에서는 편집 패널이 화면의 절반뿐이라 높이가 실제보다 훨씬 크게
        // 잡혔고 그만큼 남색 여백만 늘어나 사진이 작아 보였다.
        ref={boxRef}
        style={{ height: boxHeight, minHeight: 260 }}
      >
        {localUrl ? (
          <ManualMaskStage
            ref={maskStageRef}
            photoUrl={localUrl}
            regions={regions}
            onShapeChange={setHasShape}
            // 자재 메뉴가 바로 아래에 늘 보이므로 스테이지 안의 여는 버튼은 감춘다.
            panelOpen
            embedded
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            {loadError ? (
              <p className="text-[13px] font-light text-red-300">{loadError}</p>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-indigo-300" />
                <p className="text-[13px] font-light text-slate-300">시공 후 사진을 불러오는 중...</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* --- 아래: 조작 메뉴. 스크롤은 오직 여기서만 일어난다 ---
          overscroll-contain은 끝까지 내렸을 때 바깥 패널로 스크롤이 이어지는 것을,
          onTouchMove의 stopPropagation은 이 위에서 시작한 터치가 위쪽 캔버스 쪽으로
          흘러가 엉뚱한 점이 찍히는 것을 막는다. */}
      <div
        className="h-[46%] shrink-0 touch-pan-y overflow-y-auto overscroll-contain border-t border-slate-200 px-4 py-4"
        onTouchMove={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-xs leading-relaxed text-slate-500">
          구역을 잡고 자재를 고르면 아래 목록에 쌓입니다. 다 고른 뒤
          <span className="font-medium text-slate-700"> 맨 아래 [AI 시공 사진 만들기]</span>를 한 번만 누르세요.
          1손가락은 그리기, 2손가락은 확대·이동입니다.
        </p>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</p>
        )}

        <MaterialPicker
          regions={regions}
          onRemoveRegion={(id) => setRegions((prev) => prev.filter((r) => r.id !== id))}
          hasShape={hasShape}
          onPickMaterial={commitRegion}
        />

        {/* [문구·그림] 최종 버튼 바로 위. 여기 적은 글씨는 아래에서 프롬프트 끝에
            붙어 한 번에 함께 전송된다. */}
        <label className="mt-5 block">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Wand2 className="h-3 w-3" />
            새길 문구·그림 (선택사항)
          </span>
          <input
            type="text"
            value={overlayText}
            onChange={(e) => setOverlayText(e.target.value)}
            placeholder="예: EDEN GARDEN"
            className="mt-1 w-full border-0 border-b border-slate-900/10 bg-transparent px-0 pb-2 pt-1.5 text-[14px] font-light text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:ring-0"
          />
        </label>

        <button
          type="button"
          disabled={regions.length === 0 || submitting || busy}
          onClick={handleApply}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-indigo-600 text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(79,70,229,0.4)] transition-transform active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {submitting || busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {busy ? "AI가 다시 그리는 중..." : "보내는 중..."}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {regions.length > 0
                ? `AI 시공 사진 만들기 (${regions.length}개 구역)`
                : "AI 시공 사진 만들기"}
            </>
          )}
        </button>

        {extras && <div className="mt-6 border-t border-slate-100 pt-4">{extras}</div>}
      </div>
    </div>
  );
}
