"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, MousePointerClick, SlidersHorizontal, Sparkles, Users, Wand2 } from "lucide-react";
import type { JobStatusResponse } from "@/types";
import { getJobStatus, requestIllustration, requestInpaint, resolveAssetUrl, signJob } from "@/lib/api";
import AssetImage from "@/components/AssetImage";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import PremiumReceipt from "@/components/PremiumReceipt";
import ShareEstimateDialog from "@/components/community/ShareEstimateDialog";
import InteractiveResultCanvas from "@/components/InteractiveResultCanvas";
import SectorReedit from "@/components/SectorReedit";
import SiteConditionsCard from "@/components/SiteConditionsCard";
import SitePhotoGallery from "@/components/SitePhotoGallery";
import SwatchPicker from "@/components/ui/SwatchPicker";
import { PATTERN_SWATCHES } from "@/lib/patternSwatches";

type ViewTab = "result" | "sector";

const TAB_META: { id: ViewTab; label: string }[] = [
  { id: "result", label: "시공 결과 (After)" },
  { id: "sector", label: "구역 부분 편집" },
];

const EDIT_POLL_MS = 1500;
// SDXL 인페인팅이 응답 없이 멈추거나 서버가 재시작돼 editing 플래그가 영원히
// true로 남는 경우에도 프론트가 무한정 폴링하지 않도록 하는 안전장치.
const EDIT_TIMEOUT_MS = 90_000;

export default function SimulationPanel({
  job,
  ownerToken,
  onSecretHold,
}: {
  job: JobStatusResponse;
  /** 사장님 기기의 관리자 토큰. 현장 사진 업로드·블로그 글 작성은 사장님 전용이다. */
  ownerToken: string | null;
  /** 견적서 안 상호 뱃지를 3초 길게 눌렀을 때 — 단가 설정을 연다. */
  onSecretHold?: () => void;
}) {
  const [tab, setTab] = useState<ViewTab>("result");
  // 결과 탭에서 "AI 영역 선택" 모드와 "시공 전후 비교" 모드를 토글한다 — 기본은
  // 기존 영역 클릭 기능(InteractiveResultCanvas)이고, 비교는 눌렀을 때만 보여준다.
  const [compareMode, setCompareMode] = useState(false);
  const [liveJob, setLiveJob] = useState(job);
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedRegionLabel, setSelectedRegionLabel] = useState<string | null>(null);
  const [lastColorId, setLastColorId] = useState(PATTERN_SWATCHES[0].id);
  // 우드 계열(오크/월넛)을 고를 때만 보이는 결 방향. 기본은 가로결.
  const [grainHorizontal, setGrainHorizontal] = useState(true);
  const [pickHint, setPickHint] = useState(false);
  const [illustText, setIllustText] = useState("");
  const [illustDesc, setIllustDesc] = useState("");
  const editPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 폴링할 때마다(매 1.5~2초) liveJob이 새 객체로 갱신되므로, 그대로 map하면
  // 매번 새 배열 참조가 생겨 InteractiveResultCanvas가 사진/마스크를 계속 다시
  // 로드하는 "무한 반복" 깜빡임이 생긴다. 그렇다고 job_id에만 묶으면, 처음
  // "대기 중"(regions: [])으로 마운트된 빈 배열에 메모가 얼어붙어 완료 후에도
  // 클릭 대상이 영영 0개가 된다 — regions는 완료 시점에 한 번만 채워지므로
  // job_id + 개수 조합으로 묶으면 두 문제를 모두 피할 수 있다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolvedRegions = useMemo(
    () => liveJob.regions.map((r) => ({ ...r, mask_url: resolveAssetUrl(r.mask_url) })),
    [liveJob.job_id, liveJob.regions.length]
  );

  // 부모(page.tsx)가 폴링 중에 넘겨주는 job은 상태가 바뀔 때마다(대기 중 → 처리 중 →
  // 완료) 매번 새 객체로 들어온다. job_id가 바뀔 때만 동기화하면, 처음 "대기 중"
  // 상태로 마운트된 스냅샷에 그대로 멈춰 있게 되어 백엔드가 실제로 완료된 뒤에도
  // 화면은 "처리 중" 스피너를 영원히 보여주는 버그가 생긴다(무한 로딩) — 완료
  // 후에는 부모가 더 이상 job을 갱신하지 않으므로, 매번 동기화해도 이후 부위별
  // AI 편집으로 갈라진 liveJob을 덮어쓸 위험은 없다.
  useEffect(() => {
    setLiveJob(job);
  }, [job]);

  // 새 job(다른 사진으로 재요청, 다른 견적 불러오기 등)이 시작될 때만 선택/편집
  // 상태를 초기화한다.
  useEffect(() => {
    setSelectedRegionId(null);
    setSelectedRegionLabel(null);
    if (editPollRef.current) clearInterval(editPollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.job_id]);

  useEffect(() => {
    return () => {
      if (editPollRef.current) clearInterval(editPollRef.current);
    };
  }, []);

  function startEditPolling(jobId: string) {
    if (editPollRef.current) clearInterval(editPollRef.current);
    const startedAt = Date.now();
    editPollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > EDIT_TIMEOUT_MS) {
        if (editPollRef.current) clearInterval(editPollRef.current);
        editPollRef.current = null;
        setLiveJob((prev) => ({
          ...prev,
          editing: false,
          editing_region_id: undefined,
          edit_error: "AI 렌더링이 응답 시간 내에 완료되지 않았습니다. 다시 시도해주세요.",
        }));
        return;
      }
      try {
        const status = await getJobStatus(jobId);
        setLiveJob(status);
        if (!status.editing && editPollRef.current) {
          clearInterval(editPollRef.current);
          editPollRef.current = null;
        }
      } catch {
        if (editPollRef.current) clearInterval(editPollRef.current);
        editPollRef.current = null;
        setLiveJob((prev) => ({ ...prev, editing: false, edit_error: "편집 상태 조회에 실패했습니다." }));
      }
    }, EDIT_POLL_MS);
  }

  if (liveJob.status === "failed") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          {/* 서버가 실제로 실패를 알려준 경우에만 이 화면이 나온다. 예전에는 프론트의
              시간 초과까지 여기로 흘러들어와, 다 끝난 작업에도 "영역 인식 실패"가
              떴다(app/page.tsx의 STALL_TIMEOUT_MS 주석 참고). */}
          <p className="text-sm font-medium">시뮬레이션에 실패했습니다. 사진을 다시 촬영해 주세요.</p>
          {liveJob.error && <p className="mt-1 text-xs text-red-600/80">{liveJob.error}</p>}
        </div>
      </div>
    );
  }

  if (liveJob.status !== "done" || !liveJob.estimate) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        {/* 서버가 알려준 현재 단계를 그대로 보여준다 — 고객 앞에서 기다리는 동안
            "멈춘 건지 진행 중인지"를 사장님이 바로 읽을 수 있어야 한다. */}
        <p className="text-sm">
          {liveJob.stage ?? (liveJob.status === "queued" ? "대기 중..." : "AI가 영역을 인식하고 렌더링하는 중입니다...")}
        </p>
      </div>
    );
  }

  const resultUrl = liveJob.rendered_image_url ? resolveAssetUrl(liveJob.rendered_image_url) : undefined;
  const beforeUrl = liveJob.original_image_url ? resolveAssetUrl(liveJob.original_image_url) : undefined;

  function handleSelectRegion(regionId: string | null, label: string | null) {
    setSelectedRegionId(regionId);
    setSelectedRegionLabel(label);
  }

  async function handleIllustration() {
    if (liveJob.editing) return;
    if (!illustText.trim() && !illustDesc.trim()) return;

    setLiveJob((prev) => ({ ...prev, editing: true, editing_region_id: undefined, edit_error: undefined }));
    try {
      await requestIllustration(liveJob.job_id, illustText.trim(), illustDesc.trim());
      startEditPolling(liveJob.job_id);
    } catch (err) {
      setLiveJob((prev) => ({
        ...prev,
        editing: false,
        edit_error: err instanceof Error ? err.message : "일러스트 생성 요청에 실패했습니다.",
      }));
    }
  }

  async function handleSwatchSelect(colorId: string, horizontal = grainHorizontal) {
    setLastColorId(colorId);
    if (!selectedRegionId) {
      setPickHint(true);
      setTimeout(() => setPickHint(false), 2000);
      return;
    }
    if (liveJob.editing) return;

    setLiveJob((prev) => ({ ...prev, editing: true, editing_region_id: selectedRegionId, edit_error: undefined }));
    try {
      await requestInpaint(liveJob.job_id, selectedRegionId, colorId, horizontal);
      startEditPolling(liveJob.job_id);
    } catch (err) {
      setLiveJob((prev) => ({
        ...prev,
        editing: false,
        editing_region_id: undefined,
        edit_error: err instanceof Error ? err.message : "AI 편집 요청에 실패했습니다.",
      }));
    }
  }

  async function handleSign(dataUrl: string) {
    const updated = await signJob(liveJob.job_id, dataUrl);
    setLiveJob((prev) => ({ ...prev, signature: updated.signature }));
  }

  // 결 방향을 바꾸면, 지금 우드 색이 이미 적용돼 있을 때만 그 방향으로 다시 칠한다
  // (색을 아직 안 골랐으면 다음에 고를 때 이 방향이 쓰이도록 상태만 저장해둔다).
  function handleGrainChange(horizontal: boolean) {
    setGrainHorizontal(horizontal);
    if (selectedRegionId && lastColorId.includes("wood") && !liveJob.editing) {
      void handleSwatchSelect(lastColorId, horizontal);
    }
  }

  return (
    /* 펼친 화면에서는 마스터-디테일로 갈라진다 — 왼쪽(60%)은 고객과 함께 보는 사진과
       편집 도구, 오른쪽(40%)은 따로 스크롤되는 견적·작업사진 패널. */
    <div className="space-y-4 foldLandscape:flex foldLandscape:h-full foldLandscape:gap-5 foldLandscape:space-y-0">
      <div className="glass-panel overflow-hidden foldLandscape:h-full foldLandscape:w-3/5 foldLandscape:shrink-0 foldLandscape:overflow-y-auto">
        {/* iOS 세그먼티드 컨트롤 형태 — 밑줄 탭보다 손가락으로 정확히 누르기 쉽다. */}
        <div className="p-2">
          <div className="flex gap-1 rounded-full bg-slate-900/[0.05] p-1">
            {TAB_META.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-full px-2 py-2.5 text-[13px] font-semibold transition-all duration-200 ${
                  tab === t.id
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500 active:scale-95"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-100">
          {tab === "result" &&
            (resultUrl ? (
              <div className="space-y-0">
                {/* 시공 전 사진이 있을 때만 비교 버튼을 보여준다(수동 재편집 등으로
                    원본이 없는 옛 작업은 버튼 자체가 안 뜬다). */}
                {beforeUrl && (
                  <div className="flex justify-end border-b border-slate-200 bg-white px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setCompareMode((v) => !v)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                        compareMode ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {compareMode ? "영역 선택 모드로" : "시공 전후 비교"}
                    </button>
                  </div>
                )}

                {compareMode && beforeUrl ? (
                  <BeforeAfterSlider beforeSrc={beforeUrl} afterSrc={resultUrl} className="aspect-[4/3] w-full" />
                ) : (
                  <>
                    {/* [최종 뷰어]
                        이 탭은 고객에게 보여주고 그대로 인쇄(PDF)하는 화면이다. 색상 스와치,
                        문구 입력, "AI로 시공 사진 만들기" 같은 조작 UI는 전부 [구역 부분 편집]
                        탭으로 옮겼다 — 결과지에 편집 도구가 섞여 있으면 지저분하고, 고객 앞에서
                        실수로 눌러 결과가 바뀌는 사고도 난다. */}
                    <InteractiveResultCanvas
                      imageUrl={resultUrl}
                      regions={resolvedRegions}
                      selectedRegionId={selectedRegionId}
                      onSelectRegion={handleSelectRegion}
                      editingRegionId={liveJob.editing ? liveJob.editing_region_id : null}
                    />
                    {/* 부위를 고르면(점선 테두리) 색을 바꾸는 곳은 바로 옆 탭이다 —
                        고객 앞 결과지에는 색상 칩을 섞지 않는다는 원칙을 지키면서도
                        "선택은 했는데 아무 반응이 없다"는 느낌이 없도록 다음 동작을 알려준다. */}
                    {selectedRegionId && !liveJob.editing && (
                      <p className="border-t border-slate-200 bg-indigo-50/60 px-4 py-2.5 text-[12px] font-semibold text-indigo-700">
                        {selectedRegionLabel} 선택됨 — 위 [구역 부분 편집] 탭에서 색상을 고르면 바로 적용돼요
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center text-sm text-slate-400">
                이미지가 없습니다
              </div>
            ))}

          {tab === "sector" &&
            (resultUrl ? (
              <div className="space-y-0">
                <SectorReedit
                  key={resultUrl}
                  jobId={liveJob.job_id}
                  imageUrl={resultUrl}
                  busy={liveJob.editing}
                  extras={
                    resolvedRegions.length > 0 ? (
                      <div className="space-y-3">
                        <div>
                          <p className="text-[13px] font-bold text-slate-800">인식된 부위 색상 바꾸기</p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                            [시공 결과] 탭 사진에서 바꿀 부위를 눌러 선택한 뒤, 여기서 색을 고르면 그 부위만 바로 다시 칠해요.
                          </p>
                        </div>
                        <p className="text-[12px] font-semibold text-slate-600">
                          {selectedRegionId ? `${selectedRegionLabel} 선택됨` : "아직 선택한 부위가 없어요"}
                        </p>
                        <div className={liveJob.editing ? "pointer-events-none opacity-40" : ""}>
                          <SwatchPicker swatches={PATTERN_SWATCHES} selectedId={lastColorId} onSelect={handleSwatchSelect} size="sm" />
                        </div>
                        {/* 오크/월넛처럼 결이 있는 자재를 골랐을 때만 보인다 — 단색에는 의미가 없다. */}
                        {lastColorId.includes("wood") && (
                          <div className={`flex items-center gap-2 ${liveJob.editing ? "pointer-events-none opacity-40" : ""}`}>
                            <span className="text-[12px] font-medium text-slate-500">나뭇결 방향</span>
                            <div className="flex gap-1 rounded-full bg-slate-100 p-1">
                              {([
                                { horizontal: true, label: "가로결" },
                                { horizontal: false, label: "세로결" },
                              ] as const).map((opt) => (
                                <button
                                  key={opt.label}
                                  type="button"
                                  onClick={() => handleGrainChange(opt.horizontal)}
                                  className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                                    grainHorizontal === opt.horizontal
                                      ? "bg-white text-indigo-600 shadow-sm"
                                      : "text-slate-500"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {pickHint && (
                          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-rose-600">
                            <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
                            먼저 [시공 결과] 탭 사진에서 바꿀 부위를 눌러 선택해 주세요
                          </p>
                        )}
                        {liveJob.edit_error && (
                          <p className="text-[12px] font-semibold text-rose-600">{liveJob.edit_error}</p>
                        )}
                      </div>
                    ) : undefined
                  }
                  onSubmitted={() => {
                    setLiveJob((prev) => ({ ...prev, editing: true, edit_error: undefined }));
                    startEditPolling(liveJob.job_id);
                  }}
                />
              </div>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center text-sm text-slate-400">
                편집할 시공 후 사진이 없습니다
              </div>
            ))}

        </div>
      </div>

      <div className="space-y-4 foldLandscape:h-full foldLandscape:w-2/5 foldLandscape:overflow-y-auto foldLandscape:pb-32">
        <PremiumReceipt
          estimate={liveJob.estimate}
          jobId={liveJob.job_id}
          onSecretHold={onSecretHold}
          signature={liveJob.signature}
          onSign={handleSign}
        />

        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-white text-[13px] font-semibold text-indigo-600 shadow-sm"
        >
          <Users className="h-4 w-4" />
          이 견적 커뮤니티에 공유하기
        </button>
        {liveJob.estimate && (
          <ShareEstimateDialog estimate={liveJob.estimate} open={shareOpen} onClose={() => setShareOpen(false)} />
        )}

        <SiteConditionsCard key={`${liveJob.job_id}-conditions`} jobId={liveJob.job_id} initial={liveJob.site_conditions} />

        {/* job_id를 key로 줘서, 다른 견적을 불러올 때 이전 견적의 사진/블로그 로컬
            상태가 그대로 남아 뒤섞이지 않고 새로 마운트되게 한다. */}
        <SitePhotoGallery
          key={liveJob.job_id}
          jobId={liveJob.job_id}
          initialPhotos={liveJob.work_photos}
          initialBlogPost={liveJob.blog_post}
          ownerToken={ownerToken}
          isDone={liveJob.status === "done"}
          hasSignature={!!liveJob.signature}
        />
      </div>
    </div>
  );
}
