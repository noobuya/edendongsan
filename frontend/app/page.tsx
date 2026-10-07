"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, Bot, Calculator, FolderOpen, Loader2, Newspaper, Ruler, Sparkles, Users } from "lucide-react";
import BusinessBadge from "@/components/BusinessBanner";
import CanvasStage from "@/components/CanvasStage";
import PricingSheet from "@/components/PricingSheet";
import QuoteListDialog from "@/components/QuoteListDialog";
import SimulationPanel from "@/components/SimulationPanel";
import ManualMaskStage, { type MaskStageHandle } from "@/components/ManualMaskStage";
import StepItems from "@/components/steps/StepItems";
import StepMapping from "@/components/steps/StepMapping";
import StepSite from "@/components/steps/StepSite";
import { checkOwnerToken, checkServerHealth, createJob, getJobStatus, resolveAssetUrl } from "@/lib/api";
import { clearOwnerToken, readOwnerToken, saveOwnerToken } from "@/lib/ownerToken";
import { useAndroidBack } from "@/lib/useAndroidBack";
import { DEFAULT_OPTIONS, DEFAULT_WORK_ITEMS, taskTypeOf } from "@/lib/workItems";
import type { JobOptionsState, JobStatusResponse, MappedRegion, RenderMode, WorkItemId } from "@/types";

const POLL_INTERVAL_MS = 2000;
// [왜 "총 소요 시간"으로 실패를 판정하지 않는가]
// 예전에는 제출 후 120초가 지나면 무조건 실패로 처리했다. 그런데 상·하부장이 많은
// 주방 사진은 인식할 부위가 24개라 정상적으로 121초가 걸렸고, 서버가 결과를 다 만들어
// 저장한 뒤에도 화면에는 "영역 인식에 실패했습니다"가 떴다. 사진 탓이 아니라 시계 탓에
// 멀쩡한 견적을 버린 것이다.
//
// 그래서 기준을 "한 단계에서 멈춰 있는 시간"으로 바꾼다. 서버는 단계가 넘어갈 때마다
// stage를 갱신하므로(백엔드 pipeline._stage), 값이 바뀌는 동안은 아무리 오래 걸려도
// 기다린다. 진짜로 멈춘 경우(SAM/Gemini 무응답)에만 같은 단계에 갇혀 아래 한계를 넘는다.
const STALL_TIMEOUT_MS = 240_000;
// 이 시간을 넘기면 "느리다"고만 알려주고 계속 기다린다 — 실패로 단정하지 않는다.
const SLOW_NOTICE_MS = 60_000;
// 현장 와이파이는 끊겼다 붙었다 한다. 한 번 실패했다고 작업을 버리지 않고 이만큼
// 연속으로 실패했을 때만 포기한다.
const MAX_CONSECUTIVE_ERRORS = 5;
const STALL_MESSAGE =
  "서버가 응답하지 않아 중단했습니다. 잠시 후 '불러오기'에서 같은 견적을 다시 열어보세요.";

type Step = 1 | 2 | 3;

export default function HomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [selectedItems, setSelectedItems] = useState<WorkItemId[]>(DEFAULT_WORK_ITEMS);
  const [options, setOptions] = useState<JobOptionsState>(DEFAULT_OPTIONS);
  const [job, setJob] = useState<JobStatusResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 실패가 아니라 "아직 진행 중"이라는 안내 — 빨간 오류와 구분해서 띄운다.
  const [slowNotice, setSlowNotice] = useState<string | null>(null);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [renderMode, setRenderMode] = useState<RenderMode>("auto");
  const [autoDescription, setAutoDescription] = useState("");
  const [mappedRegions, setMappedRegions] = useState<MappedRegion[]>([]);
  const [hasShape, setHasShape] = useState(false);
  // 수동 마스킹 중 조작 패널을 접어둔 상태 — 사진을 화면 가득 쓰기 위한 것.
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [exitHint, setExitHint] = useState(false);
  // 카메라 시트도 "떠 있는 것"이라 뒤로 가기가 먼저 닫아야 한다 — 그래서 여기서 든다.
  const [cameraOpen, setCameraOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maskStageRef = useRef<MaskStageHandle>(null);
  const regionIdRef = useRef(1);
  // 사장님 기기 표시(관리자 토큰). 서버 렌더링 때는 모르므로 mount 후에 이 기기에서 읽는다.
  const [ownerToken, setOwnerTokenState] = useState<string | null>(null);
  // 저장된 값만 믿지 않는다. 서버가 토큰을 맞다고 할 때만 사장님 기기로 연다.
  // 틀리면 저장된 토큰을 지우고, 서버에 닿지 않으면 이번에는 열지 않되 토큰은 남긴다.
  useEffect(() => {
    const saved = readOwnerToken();
    if (!saved) return;
    void checkOwnerToken(saved).then((result) => {
      if (result === "ok") setOwnerTokenState(saved);
      else if (result === "rejected") clearOwnerToken();
    });
  }, []);

  // 맞춰둔 도형 + 고른 자재를 한 세트(Region)로 묶어 저장하고, 캔버스를 비워
  // 다음 영역을 지정할 수 있게 한다.
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
      setMappedRegions((prev) => [
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
          // 백엔드가 마스터 프롬프트(극사실 카메라 설정 등)를 앞뒤로 덧붙이므로,
          // 여기서는 "무엇을 시공하는지"만 사람 말로 담는다.
          prompt: optionLabel,
          // 문구·로고는 프롬프트에 미리 섞지 않고 따로 보낸다 — 백엔드가 이 값이
          // 있을 때만 렌더링 방식을 글자 쪽에 맞게 바꾸기 때문이다(ai_service).
          customDesign: customDesign || undefined,
          // 문짝/문틀에서만 의미 있음 — 나무 문(기본)인지 현관문·방화문 같은 스틸
          // 문인지. AI 편집 지시문이 문 재질에 맞는 문장을 쓰도록 갈라 준다.
          doorMaterial,
          colorIndex: prev.length,
        },
      ]);
      maskStageRef.current?.clearShape();
    },
    []
  );

  // "한 번 더 누르면 종료" 안내 (useAndroidBack이 쏘는 이벤트)
  useEffect(() => {
    const onHint = () => {
      setExitHint(true);
      setTimeout(() => setExitHint(false), 2000);
    };
    window.addEventListener("app:exit-hint", onHint);
    return () => window.removeEventListener("app:exit-hint", onHint);
  }, []);

  // 수동 마스킹은 화면 전체를 사진에 내준다.
  const masking = step === 2 && renderMode === "manual" && !!previewUrl;
  // 그리는 동안에는 조작 패널을 접어 사진을 가리지 않게 한다. 도형을 다 만들면
  // 자재를 골라야 하므로 다시 펴진다(ManualMaskStage의 onDrawFocus).
  const panelOpen = !masking || !panelCollapsed;

  /** 뒤로 가기 한 번이 "무엇을 되돌릴지" 정하는 곳. 폰 하드웨어 버튼과 웹 브라우저
   *  뒤로 가기가 똑같이 이 함수를 쓴다 — 두 군데에 따로 쓰면 반드시 어긋난다.
   *
   *  true를 돌려주면 "내가 처리했으니 나가지 마라"는 뜻이다.
   *  순서는 화면에 덮인 순서의 반대 — 가장 위에 뜬 것부터 닫는다. */
  const goBack = useCallback((): boolean => {
    // 1순위: 떠 있는 팝업/시트부터 닫는다. 단계를 깎으면 안 된다.
    if (pricingOpen) {
      setPricingOpen(false);
      return true;
    }
    if (quoteDialogOpen) {
      setQuoteDialogOpen(false);
      return true;
    }
    if (cameraOpen) {
      setCameraOpen(false);
      return true;
    }
    // 수동 마스킹 중 자재 패널이 올라와 있으면 사진으로 먼저 돌아간다.
    if (masking && !panelCollapsed) {
      setPanelCollapsed(true);
      return true;
    }
    // 2순위: 단계 내리기 (3 -> 2 -> 1)
    if (step > 1) {
      setStep((prev) => (prev === 3 ? 2 : 1));
      return true;
    }
    // 3순위: 1단계 + 열린 것 없음 -> 그때만 이탈을 허용한다.
    return false;
  }, [pricingOpen, quoteDialogOpen, cameraOpen, masking, panelCollapsed, step]);

  // 폰 하드웨어 뒤로 가기
  useAndroidBack(goBack);

  // 웹 브라우저 뒤로 가기.
  //
  // 이 앱은 주소가 바뀌지 않는 한 페이지짜리라 히스토리가 쌓이지 않는다. 그래서
  // 브라우저 뒤로 가기를 누르면 단계와 무관하게 앱을 바로 떠나 버린다.
  // 가짜 히스토리 한 칸을 항상 물려 두고, 뒤로 가기가 그 칸을 먹을 때마다
  // goBack()을 돌린 뒤 다시 한 칸을 채워 넣는다. 되돌릴 게 없을 때만 채우지 않아
  // 그다음 뒤로 가기가 자연스럽게 페이지를 떠난다.
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  const sentinelPushed = useRef(false);
  useEffect(() => {
    // 개발 모드에서 React는 이 훅을 일부러 두 번 실행한다. 그대로 두면 가짜
    // 히스토리가 두 칸 쌓여 뒤로 가기 한 번이 두 번처럼 동작한다.
    if (!sentinelPushed.current) {
      sentinelPushed.current = true;
      window.history.pushState({ appBack: true }, "");
    }
    const onPop = () => {
      if (goBackRef.current()) window.history.pushState({ appBack: true }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);


  // 서버에 닿는지 앱을 켜자마자 한 번 확인한다. 현장에서 견적을 다 입력하고 나서야
  // "연결 안 됨"을 알게 되면 그 시간이 통째로 날아간다.
  useEffect(() => {
    void checkServerHealth().then(setServerOnline);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // 수동 마스킹에 들어가면 패널을 접고 시작한다. 첫 동작이 "사진에 도형 그리기"라
  // 패널이 사진을 덮고 있으면 그릴 곳부터 안 보인다.
  useEffect(() => {
    if (step === 2 && renderMode === "manual") setPanelCollapsed(true);
  }, [step, renderMode]);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId) return;
    getJobStatus(jobId)
      .then((status) => {
        setJob(status);
        setStep(3);
      })
      .catch(() => {
        /* 만료된 견적이면 조용히 무시하고 1단계로 둔다 */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncJobToUrl(jobId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("job", jobId);
    router.replace(`${url.pathname}?${url.searchParams.toString()}`);
  }

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function pollJob(jobId: string) {
    // 마지막으로 "진행됐다"고 확인한 시각. 단계(stage)나 상태가 바뀔 때마다 갱신되며,
    // 실패 판정은 오직 이 시각을 기준으로 한다.
    let lastProgressAt = Date.now();
    let lastSignature = "";
    let consecutiveErrors = 0;

    setSlowNotice(null);
    pollRef.current = setInterval(async () => {
      try {
        const status = await getJobStatus(jobId);
        consecutiveErrors = 0;
        setJob(status);

        if (status.status === "done" || status.status === "failed") {
          stopPolling();
          setSubmitting(false);
          setSlowNotice(null);
          return;
        }

        // 서버가 다음 단계로 넘어갔으면 시계를 다시 0부터 센다.
        const signature = `${status.status}|${status.stage ?? ""}`;
        if (signature !== lastSignature) {
          lastSignature = signature;
          lastProgressAt = Date.now();
        }

        const stalledFor = Date.now() - lastProgressAt;
        if (stalledFor > STALL_TIMEOUT_MS) {
          stopPolling();
          setSubmitting(false);
          setSlowNotice(null);
          setSubmitError(STALL_MESSAGE);
          return;
        }
        // 오래 걸리는 것과 실패한 것은 다르다 — 기다리는 중이라고만 알린다.
        setSlowNotice(stalledFor > SLOW_NOTICE_MS ? "사진에 인식할 부위가 많아 조금 더 걸립니다" : null);
      } catch (err) {
        // 잠깐 끊긴 것일 수 있으니 바로 포기하지 않는다. 그동안 서버는 계속 일하고 있다.
        consecutiveErrors += 1;
        if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
          setSlowNotice("서버와 연결이 불안정합니다. 다시 시도하는 중...");
          return;
        }
        stopPolling();
        setSubmitting(false);
        setSlowNotice(null);
        const message = err instanceof Error ? err.message : "작업 조회 중 오류가 발생했습니다.";
        setSubmitError(message);
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleSubmit() {
    // 일러스트는 사장님 기기에서만 보낸다. 학생 기기가 담아 와도 여기서 걸러낸다.
    const submitItems = ownerToken ? selectedItems : selectedItems.filter((i) => i !== "illustration");
    if (!photo || submitItems.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setStep(3);
    try {
      const withIllustration = submitItems.includes("illustration");
      const { job_id } = await createJob({
        photo,
        customerName,
        selectedItems: submitItems,
        options,
        illustrationText: withIllustration ? options.illustration.text : "",
        illustrationDescription: withIllustration ? options.illustration.description : "",
        ownerToken,
        renderMode,
        autoDescription,
        manualRegions: renderMode === "manual" ? mappedRegions : [],
      });
      setJob({
        job_id,
        status: "queued",
        regions: [],
        editing: false,
        customer_name: customerName,
        work_photos: [],
      });
      syncJobToUrl(job_id);
      pollJob(job_id);
    } catch (err) {
      console.error(err);
      setSubmitting(false);
      setStep(2);
      setSubmitError(err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.");
    }
  }

  async function handleLoadQuote(jobId: string) {
    setQuoteDialogOpen(false);
    setSubmitError(null);
    try {
      const status = await getJobStatus(jobId);
      setJob(status);
      setStep(3);
      syncJobToUrl(jobId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "견적서를 불러오지 못했습니다.");
    }
  }

  function startNewQuote() {
    stopPolling();
    setSlowNotice(null);
    setJob(null);
    setPhoto(null);
    setCustomerName("");
    setSelectedItems(DEFAULT_WORK_ITEMS);
    setOptions(DEFAULT_OPTIONS);
    setRenderMode("auto");
    setAutoDescription("");
    setMappedRegions([]);
    setHasShape(false);
    setSubmitError(null);
    setStep(1);
    router.replace(window.location.pathname);
  }

  // 3단계에서는 무대 배경으로 시공 후 사진을 깐다.
  const stagePhotoUrl =
    step === 3 && job?.rendered_image_url ? resolveAssetUrl(job.rendered_image_url) : previewUrl;

  return (
    <main className="relative h-dvh overflow-hidden">
      {/* 무대 — 화면 전체가 뷰파인더이자 사진 뷰어다.
          수동 마스킹 중에는 무대에서 사진을 빼고 바탕만 남긴다. 안 그러면 화면을
          꽉 채운 무대 사진(object-cover)과 마스킹용 사진(object-contain)이 서로 다른
          배율로 동시에 보여서, 사진 위에 사진이 떠 있는 것처럼 보인다. */}
      <CanvasStage
        photoUrl={masking ? null : stagePhotoUrl}
        onCapture={setPhoto}
        onRetake={() => setPhoto(null)}
        showCapture={step === 1}
        cameraOpen={cameraOpen}
        onCameraOpenChange={setCameraOpen}
      />

      {/* 수동 모드의 사진은 화면 전체를 쓴다. 사진과 드로잉 캔버스가 한 덩어리로
          묶여 있어(ManualMaskStage 주석), 확대해도 둘이 어긋나지 않는다. */}
      {masking && previewUrl && (
        <div className="absolute inset-0 z-0">
          <ManualMaskStage
            ref={maskStageRef}
            photoUrl={previewUrl}
            regions={mappedRegions}
            onShapeChange={setHasShape}
            onDrawFocus={(focused) => setPanelCollapsed(focused)}
            panelOpen={panelOpen}
            onOpenPanel={() => setPanelCollapsed(false)}
          />
        </div>
      )}

      {/* 떠 있는 앱 바 */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              aria-label="이전 단계"
              className="glass-pill flex h-11 w-11 items-center justify-center text-slate-700 transition-transform active:scale-90"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <span className="glass-pill flex h-11 w-11 items-center justify-center text-indigo-600">
              <Sparkles className="h-5 w-5" />
            </span>
          )}
          {/* 단계 표시는 점 세 개로 — 숫자와 제목까지 늘어놓으면 무대가 좁아진다. */}
          <span className="glass-pill flex items-center gap-1.5 px-4 py-3">
            {([1, 2, 3] as Step[]).map((s) => (
              <span
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step ? "w-5 bg-indigo-600" : s < step ? "w-1.5 bg-indigo-300" : "w-1.5 bg-slate-900/15"
                }`}
              />
            ))}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/quote"
            aria-label="빠른 견적 (평수별·품목별)"
            className="glass-pill flex h-11 w-11 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Calculator className="h-5 w-5" />
          </Link>
          <Link
            href="/cutting"
            aria-label="스마트 재단 계산기"
            className="glass-pill flex h-11 w-11 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Ruler className="h-5 w-5" />
          </Link>
          <Link
            href="/blog"
            aria-label="시공 후기 블로그"
            className="glass-pill flex h-11 w-11 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Newspaper className="h-5 w-5" />
          </Link>
          <Link
            href="/community"
            aria-label="견적 공유"
            className="glass-pill flex h-11 w-11 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Users className="h-5 w-5" />
          </Link>
          {/* 견적서 목록은 고객 이름·금액이 들어 있는 사장님 전용 자료라 사장님
              기기에만 보여준다. */}
          {ownerToken && (
            <button
              type="button"
              onClick={() => setQuoteDialogOpen(true)}
              aria-label="견적서 불러오기"
              className="glass-pill flex h-11 w-11 items-center justify-center text-slate-700 transition-transform active:scale-90"
            >
              <FolderOpen className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>

      {/* 업체 표기는 구석 워터마크로. 세로에서는 아래를 패널이 덮으므로 앱 바 밑에,
          펼친 화면에서는 왼쪽 아래에 둔다. (3초 길게 누르면 단가 설정)
          견적 결과 화면(3단계)의 영수증 안에는 이미 이 뱃지·숨은 입구가 있었는데,
          정작 그 앞 단계(1·2단계, 사진 찍기·부위 고르기)에는 빠져 있어 견적을 끝까지
          만들어야만 단가 설정에 닿을 수 있었다 — 여기 추가해 언제든 3초 누르면 열리게
          한다. 3단계에는 그 자체 뱃지가 이미 있어 겹치지 않게 여기서는 숨긴다. */}
      {step !== 3 && (
        <div className="absolute left-4 top-20 z-20 foldLandscape:bottom-4 foldLandscape:top-auto">
          <BusinessBadge onSecretHold={() => setPricingOpen(true)} />
        </div>
      )}

      {exitHint && (
        <div className="glass-pill pointer-events-none absolute bottom-24 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold text-slate-700">
          한 번 더 누르면 앱이 종료됩니다
        </div>
      )}

      {/* 서버에 못 닿을 때만 조용히 알려준다 — 정상일 때는 아무것도 띄우지 않는다. */}
      {serverOnline === false && (
        // 알림일 뿐이므로 탭을 가로채면 안 된다 — 이 알약이 그 아래 탭 버튼을 막고 있었다.
        <div className="glass-pill pointer-events-none absolute left-1/2 top-20 z-30 flex -translate-x-1/2 items-center gap-2 px-4 py-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <span className="whitespace-nowrap text-[12px] font-medium text-slate-700">
            서버에 연결되지 않았습니다
          </span>
        </div>
      )}

      {step === 3 ? (
        /* 결과 — 무대 위에 결과 패널을 통째로 띄운다.
           아래 여백(pb-24)은 화면 아래 가운데 떠 있는 "새 현장 견적 시작" 알약 자리다.
           없으면 결과 패널의 마지막 내용이 그 알약 밑에 깔려 눌리지 않는다. */
        <section className="absolute inset-x-3 bottom-3 top-20 z-10 overflow-y-auto rounded-3xl pb-24 foldLandscape:inset-y-4 foldLandscape:left-4 foldLandscape:right-4 foldLandscape:top-20 foldLandscape:pb-4">
          {submitError && <ErrorNote message={submitError} />}
          {!submitError && slowNotice && <WaitNote message={slowNotice} />}
          {job?.notices && job.notices.length > 0 && (
            <div className="mx-1 mb-3 space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4" role="alert">
              <p className="text-[14px] font-bold text-amber-900">일부 시공이 적용되지 않았어요</p>
              {job.notices.map((n) => (
                <p key={n} className="text-[13px] leading-relaxed text-amber-900 break-keep">· {n}</p>
              ))}
            </div>
          )}
          {job ? (
            <SimulationPanel job={job} ownerToken={ownerToken} onSecretHold={() => setPricingOpen(true)} />
          ) : (
            <div className="glass-panel flex h-full flex-col items-center justify-center gap-3">
              <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
              <p className="text-[15px] font-light text-slate-600">견적을 준비하는 중입니다...</p>
            </div>
          )}
        </section>
      ) : (
        /* 조작 패널 — 화면을 반으로 가르지 않고, 여백을 두고 떠 있다.
           수동 마스킹 중에는 접혀서 사진에 자리를 내준다(접힘 상태는 아래 손잡이 바). */
        <section
          className={`glass-panel absolute inset-x-3 bottom-3 top-[38%] z-10 flex flex-col transition-transform duration-300
                     foldLandscape:inset-y-4 foldLandscape:left-auto foldLandscape:right-4 foldLandscape:top-20 foldLandscape:w-[420px] ${
                       panelOpen
                         ? ""
                         : "pointer-events-none translate-y-full foldLandscape:pointer-events-auto foldLandscape:translate-y-0"
                     }`}
        >
          {/* 접기 손잡이 — 세로 화면에서 수동 마스킹일 때만.
              펼친 화면은 패널이 오른쪽에만 있어 사진을 가리지 않으므로 접을 필요가 없다.
              (다시 펴는 버튼은 사진 아래 도구 막대에 있다 — 패널이 사진을 덮은 채로는
              그릴 곳이 안 보이므로 접었을 때는 화면에서 완전히 내려간다.) */}
          {masking && (
            <button
              type="button"
              onClick={() => setPanelCollapsed(true)}
              className="flex shrink-0 items-center justify-center gap-2 rounded-t-3xl px-7 py-4 text-[12px] font-semibold text-slate-600 foldLandscape:hidden"
            >
              <span className="h-1 w-9 rounded-full bg-slate-900/15" />
              접고 사진 보기
            </button>
          )}
          <div className={`min-h-0 flex-1 overflow-y-auto px-7 pb-20 ${masking ? "pt-1" : "pt-8"}`}>
            {submitError && <ErrorNote message={submitError} />}
            {step === 1 && (
              <StepSite
                customerName={customerName}
                onCustomerNameChange={setCustomerName}
                isOwner={!!ownerToken}
                onSaveOwnerToken={(token) => {
                  saveOwnerToken(token);
                  setOwnerTokenState(token);
                }}
                onClearOwnerToken={() => {
                  clearOwnerToken();
                  setOwnerTokenState(null);
                }}
              />
            )}
            {step === 2 && (
              <div className="space-y-9">
                <StepMapping
                  mode={renderMode}
                  onModeChange={setRenderMode}
                  autoDescription={autoDescription}
                  onAutoDescriptionChange={setAutoDescription}
                  regions={mappedRegions}
                  onRemoveRegion={(id) =>
                    setMappedRegions((prev) => prev.filter((r) => r.id !== id))
                  }
                  hasShape={hasShape}
                  onPickMaterial={commitRegion}
                />
                {/* 견적 금액은 어느 모드에서든 항목별 수량으로 계산되므로 항상 받는다. */}
                <div className="border-t border-slate-900/[0.06] pt-7">
                  <StepItems
                    selectedItems={selectedItems}
                    onSelectedItemsChange={setSelectedItems}
                    options={options}
                    onOptionsChange={setOptions}
                    isOwner={!!ownerToken}
                  />
                </div>
              </div>
            )}
          </div>

          {/* CTA는 패널 맨 아래에 붙는다. 비활성일 땐 글씨만, 활성이면 은은한 빛. */}
          <div className="shrink-0 px-7 pb-7 pt-2">
            {step === 1 ? (
              <PillButton disabled={!photo} onClick={() => setStep(2)}>
                다음 <ArrowRight className="h-[18px] w-[18px]" />
              </PillButton>
            ) : (
              <PillButton disabled={selectedItems.length === 0 || submitting} onClick={handleSubmit}>
                {submitting ? (
                  <>
                    <Loader2 className="h-[18px] w-[18px] animate-spin" />
                    AI 분석 중
                  </>
                ) : (
                  <>
                    <Sparkles className="h-[18px] w-[18px]" />
                    AI 시뮬레이션 &amp; 견적
                  </>
                )}
              </PillButton>
            )}
            {step === 1 && !photo && (
              <p className="pt-3 text-center text-[12px] font-light text-slate-400">
                현장 사진을 촬영하면 다음으로 넘어갑니다
              </p>
            )}
            {step === 1 && !photo && (
              <Link
                href="/quote"
                className="mt-3 flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/80 text-[14px] font-semibold text-indigo-700 transition-transform active:scale-[0.98]"
              >
                <Calculator className="h-4 w-4" />
                사진 없이 빠른 견적 보기
              </Link>
            )}
            {step === 1 && !photo && (
              <Link
                href="/automation"
                className="mt-2 flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/80 text-[14px] font-semibold text-indigo-700 transition-transform active:scale-[0.98]"
              >
                <Bot className="h-4 w-4" />
                자동화 작업
              </Link>
            )}
          </div>
        </section>
      )}

      {step === 3 && (
        <button
          type="button"
          onClick={startNewQuote}
          // 화면 아래 "가운데"에 두면 결과 패널의 버튼들이 그 밑에 깔려 눌리지 않는다
          // (실제로 재편집 버튼이 이 알약에 가려 눌리지 않았다). 구석으로 뺀다.
          className="glass-pill absolute bottom-6 right-4 z-20 px-5 py-3 text-[13px] font-semibold text-slate-800 transition-transform active:scale-95 foldLandscape:right-8"
        >
          새 현장 견적 시작
        </button>
      )}

      <PricingSheet open={pricingOpen} onClose={() => setPricingOpen(false)} />

      <QuoteListDialog
        open={quoteDialogOpen}
        onClose={() => setQuoteDialogOpen(false)}
        onSelect={handleLoadQuote}
        ownerToken={ownerToken ?? ""}
      />
    </main>
  );
}

/** "느리다"는 실패가 아니다 — 빨간 오류와 확실히 다르게 보이도록 따로 둔다. */
function WaitNote({ message }: { message: string }) {
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-amber-200/60 bg-amber-50/80 px-4 py-3.5 text-[13px] font-light text-amber-800 backdrop-blur-sm">
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      <span>{message}</span>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-red-200/60 bg-red-50/80 px-4 py-3.5 text-[13px] font-light text-red-700 backdrop-blur-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function PillButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-14 w-full items-center justify-center gap-2 rounded-full text-[16px] tracking-tight transition-all duration-300 active:scale-[0.98] ${
        disabled
          ? "bg-slate-900/[0.04] font-light text-slate-400"
          : "bg-indigo-600 font-semibold text-white shadow-[0_10px_40px_rgba(79,70,229,0.45)]"
      }`}
    >
      {children}
    </button>
  );
}
