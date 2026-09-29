"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, X } from "lucide-react";
import ManualMaskStage, { type MaskStageHandle } from "@/components/ManualMaskStage";
import MaterialPicker from "@/components/MaterialPicker";
import { fetchAssetObjectUrl, remaskJob } from "@/lib/api";
import { taskTypeOf } from "@/lib/workItems";
import type { MappedRegion, WorkItemId } from "@/types";

interface Props {
  jobId: string;
  /** 지금 화면에 떠 있는 시공 후 사진. 이 사진 위에 구역을 다시 잡는다. */
  imageUrl: string;
  onClose: () => void;
  /** 다시 적용 요청이 서버에 접수됐을 때 — 부모가 진행 상태를 폴링하도록. */
  onSubmitted: () => void;
}

/** 3단계에서 결과 사진을 다시 손보는 전체 화면 편집기.
 *
 *  2단계(처음 견적)와 완전히 같은 엔진을 쓴다 — 사진과 도형이 한 덩어리인 Konva
 *  스테이지, 두 손가락 확대/이동, 무한 꼭짓점 다각형, 변 잡아 당기기, 타원 마스킹,
 *  그리고 같은 자재 선택 패널(MaterialPicker)이다. 두 화면이 따로 놀지 않도록
 *  컴포넌트를 그대로 재사용한다.
 *
 *  다른 점은 단 하나, 바탕 사진이 "원본"이 아니라 "1차 시뮬레이션 결과"라는 것이다.
 *  고객 앞에서 한 곳씩 바꿔 보는 작업이라 앞서 정한 시공이 남아 있어야 한다. */
export default function ReeditOverlay({ jobId, imageUrl, onClose, onSubmitted }: Props) {
  const maskStageRef = useRef<MaskStageHandle>(null);
  const regionIdRef = useRef(1);
  const [regions, setRegions] = useState<MappedRegion[]>([]);
  const [hasShape, setHasShape] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 사진은 반드시 blob으로 받아서 넘긴다.
  // 결과 사진 주소는 ngrok을 거치는데, 그 주소를 <img>나 new Image()에 그대로 물리면
  // 경고 페이지가 대신 내려와 로딩이 실패한다. 그러면 편집기가 "아무것도 없는 화면"으로
  // 뜨고 원인도 보이지 않는다(AssetImage가 존재하는 이유와 같다).
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
    (category: WorkItemId, option: string, optionLabel: string, customDesign: string) => {
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
          colorIndex: prev.length,
        },
      ]);
      maskStageRef.current?.clearShape();
    },
    []
  );

  async function handleApply() {
    if (regions.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await remaskJob(jobId, regions);
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "다시 적용에 실패했습니다.");
      setSubmitting(false);
    }
  }

  const panelOpen = !panelCollapsed;

  // [본문(body)에 직접 붙이는 이유]
  // 이 편집기는 결과 패널(z-10) 안에서 렌더링되는데, 부모가 z-index를 갖는 순간
  // 그 안의 자식은 아무리 z-50을 줘도 부모보다 위로 못 올라간다. 그대로 두면
  // 앱 바·배너·"새 현장 견적 시작" 알약이 전체 화면 편집기 위로 비쳐 보인다.
  // 포털로 body에 직접 붙여 그 굴레에서 벗어난다.
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-slate-900">
      {/* 사진 + 도형 편집 — 2단계와 같은 컴포넌트 */}
      {!localUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          {loadError ? (
            <p className="text-[14px] font-light text-red-300">{loadError}</p>
          ) : (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-indigo-300" />
              <p className="text-[14px] font-light text-slate-300">시공 후 사진을 불러오는 중...</p>
            </>
          )}
        </div>
      )}
      {localUrl && (
      <ManualMaskStage
        ref={maskStageRef}
        photoUrl={localUrl}
        regions={regions}
        onShapeChange={setHasShape}
        onDrawFocus={(focused) => setPanelCollapsed(focused)}
        panelOpen={panelOpen}
        onOpenPanel={() => setPanelCollapsed(false)}
      />
      )}

      {/* 닫기 — 편집을 버리고 결과 화면으로 */}
      <button
        type="button"
        onClick={onClose}
        aria-label="편집 닫기"
        className="glass-pill absolute left-4 top-4 z-[60] flex h-11 w-11 items-center justify-center text-slate-700 transition-transform active:scale-90"
      >
        <X className="h-5 w-5" />
      </button>
      <span className="glass-pill absolute left-1/2 top-4 z-[60] -translate-x-1/2 whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold text-slate-700">
        구역 다시 잡기
      </span>

      {/* 자재 선택 패널 — 2단계와 같은 MaterialPicker */}
      <section
        className={`glass-panel absolute inset-x-3 bottom-3 top-[38%] z-[55] flex flex-col transition-transform duration-300
                   foldLandscape:inset-y-4 foldLandscape:left-auto foldLandscape:right-4 foldLandscape:top-20 foldLandscape:w-[420px] ${
                     panelOpen
                       ? ""
                       : "pointer-events-none translate-y-full foldLandscape:pointer-events-auto foldLandscape:translate-y-0"
                   }`}
      >
        <button
          type="button"
          onClick={() => setPanelCollapsed(true)}
          className="flex shrink-0 items-center justify-center gap-2 rounded-t-3xl px-7 py-4 text-[12px] font-semibold text-slate-600 foldLandscape:hidden"
        >
          <span className="h-1 w-9 rounded-full bg-slate-900/15" />
          접고 사진 보기
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-20 pt-1">
          <div className="mb-5">
            <h2 className="text-[22px] font-bold leading-tight tracking-tight text-slate-900">
              결과 다시 손보기
            </h2>
            <p className="mt-1.5 text-[13px] font-light text-slate-500">
              지금 사진 위에 구역을 잡고 자재를 고르면 그 부분만 다시 그립니다
            </p>
          </div>

          {error && (
            <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-[13px] font-light text-red-700">
              {error}
            </p>
          )}

          <MaterialPicker
            regions={regions}
            onRemoveRegion={(id) => setRegions((prev) => prev.filter((r) => r.id !== id))}
            hasShape={hasShape}
            onPickMaterial={commitRegion}
          />
        </div>

        <div className="shrink-0 px-7 pb-7 pt-2">
          <button
            type="button"
            disabled={regions.length === 0 || submitting}
            onClick={handleApply}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-indigo-600 text-[15px] font-semibold text-white shadow-[0_10px_40px_rgba(79,70,229,0.45)] transition-transform active:scale-[0.98] disabled:bg-slate-900/[0.06] disabled:text-slate-400 disabled:shadow-none"
          >
            {submitting ? (
              <>
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
                보내는 중...
              </>
            ) : (
              <>
                <Sparkles className="h-[18px] w-[18px]" />
                {regions.length > 0 ? `${regions.length}개 구역 다시 적용하기` : "다시 적용하기"}
              </>
            )}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
