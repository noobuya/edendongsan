"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, Bot, Briefcase, Calculator, FolderOpen, Images, Loader2, Newspaper, Ruler, Sparkles, Users } from "lucide-react";
import BusinessBadge from "@/components/BusinessBanner";
import CanvasStage from "@/components/CanvasStage";
import FeatureIntroDialog from "@/components/FeatureIntroDialog";
import { LayoutEditProvider, useLayoutEdit } from "@/components/LayoutEdit";
import Movable, { useMovable } from "@/components/Movable";
import PricingSheet from "@/components/PricingSheet";
import QuoteListDialog from "@/components/QuoteListDialog";
import SimulationPanel from "@/components/SimulationPanel";
import StepItems from "@/components/steps/StepItems";
import StepMapping from "@/components/steps/StepMapping";
import StepSite from "@/components/steps/StepSite";
import {
  checkOwnerToken,
  checkServerHealth,
  createJob,
  getJobStatus,
  registerOwnerPushToken,
  resolveAssetUrl,
} from "@/lib/api";
import { registerForPush } from "@/lib/pushRegistration";
import { clearOwnerToken, readOwnerToken, saveOwnerToken } from "@/lib/ownerToken";
import { useAndroidBack } from "@/lib/useAndroidBack";
import { DEFAULT_OPTIONS, DEFAULT_WORK_ITEMS } from "@/lib/workItems";
import type { JobOptionsState, JobStatusResponse, RenderMode, WorkItemId } from "@/types";

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
  // [손그림을 그만 쓰기로 함 — 2026-11]
  // "수동"(손으로 영역을 그려 자재를 지정)은 2026-10-15에 한 번 기본값이 됐었다
  // — 그때는 자동 AI 영역 인식이 엉뚱한 곳에 색을 입히는 사고가 반복됐기
  // 때문이다. 그런데 손그림도 "영역을 못 잡고 엉뚱하게 시공한다"는 신고가
  // 똑같이 반복됐고(연필로 그린 선이 실제 물체 경계와 안 맞음), 그 사이
  // 자동 인식 쪽의 진짜 원인 두 가지(천장을 캐비닛으로 오인식, 서로 다른
  // 재질을 한 통계로 묶어 하얗게 날아가던 문제)를 찾아 고쳤다. 이제 항상
  // 자동 인식만 쓴다 — 치수(가로·세로·개수) 입력은 그대로 StepItems에서 받고,
  // "어디에 시공할지"만 사람이 그리지 않고 segmentation.py가 사진에서 찾는다.
  const renderMode: RenderMode = "auto";
  const [autoDescription, setAutoDescription] = useState("");
  const [exitHint, setExitHint] = useState(false);
  // 처음 켜봤을 때만 "이런 기능도 있어요" 안내를 한 번 띄운다 — 기기에 본 적이
  // 있다고 적어두면 다시는 안 띄운다. SSR에서는 localStorage가 없으니 항상 false로
  // 시작하고, 마운트된 뒤 useEffect에서만 실제로 확인한다(hydration 불일치 방지).
  const [featureIntroOpen, setFeatureIntroOpen] = useState(false);
  // 카메라 시트도 "떠 있는 것"이라 뒤로 가기가 먼저 닫아야 한다 — 그래서 여기서 든다.
  const [cameraOpen, setCameraOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 사장님 기기 표시(관리자 토큰). 서버 렌더링 때는 모르므로 mount 후에 이 기기에서 읽는다.
  const [ownerToken, setOwnerTokenState] = useState<string | null>(null);
  // 저장된 값만 믿지 않는다. 서버가 토큰을 맞다고 할 때만 사장님 기기로 연다.
  // 틀리면 저장된 토큰을 지우고, 서버에 닿지 않으면 이번에는 열지 않되 토큰은 남긴다.
  useEffect(() => {
    const saved = readOwnerToken();
    if (!saved) return;
    void checkOwnerToken(saved).then((result) => {
      if (result === "ok") {
        setOwnerTokenState(saved);
        // 제안서 열람 알림 — 네이티브 앱이 아니거나 아직 플러그인이 없는 빌드에서는
        // registerForPush가 조용히 아무 일도 하지 않는다.
        void registerForPush((token) => void registerOwnerPushToken(saved, token).catch(() => {}));
      } else if (result === "rejected") clearOwnerToken();
    });
  }, []);

  // 이 기기에서 처음 켠 거면 "이런 기능도 있어요" 안내를 한 번 띄운다.
  useEffect(() => {
    try {
      if (!localStorage.getItem("eden_feature_intro_seen")) setFeatureIntroOpen(true);
    } catch {
      // 프라이빗 모드 등으로 localStorage를 못 읽는 드문 환경 — 안내 없이 조용히 넘어간다.
    }
  }, []);

  const dismissFeatureIntro = useCallback(() => {
    setFeatureIntroOpen(false);
    try {
      localStorage.setItem("eden_feature_intro_seen", "1");
    } catch {
      // 못 저장해도 이번 방문 동안은 이미 닫혔으니 문제 없다.
    }
  }, []);

  // "한 번 더 누르면 종료" 안내 (useAndroidBack이 쏘는 이벤트)
  useEffect(() => {
    const onHint = () => {
      setExitHint(true);
      setTimeout(() => setExitHint(false), 2000);
    };
    window.addEventListener("app:exit-hint", onHint);
    return () => window.removeEventListener("app:exit-hint", onHint);
  }, []);

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
    // 2순위: 단계 내리기 (3 -> 2 -> 1)
    if (step > 1) {
      setStep((prev) => (prev === 3 ? 2 : 1));
      return true;
    }
    // 3순위: 1단계 + 열린 것 없음 -> 그때만 이탈을 허용한다.
    return false;
  }, [pricingOpen, quoteDialogOpen, cameraOpen, step]);

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
        manualRegions: [],
      });
      setJob({
        job_id,
        status: "queued",
        regions: [],
        editing: false,
        customer_name: customerName,
        work_photos: [],
        change_orders: [],
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
    setAutoDescription("");
    setSubmitError(null);
    setStep(1);
    router.replace(window.location.pathname);
  }

  // 3단계에서는 무대 배경으로 시공 후 사진을 깐다.
  const stagePhotoUrl =
    step === 3 && job?.rendered_image_url ? resolveAssetUrl(job.rendered_image_url) : previewUrl;

  return (
    <main className="relative h-dvh">
      {/* 첫 화면 배치 편집(2026-11-05 "배치가 엉망이다 — 설정모드에서 길게 눌러
          위치·크기를 조정") — 사장님 기기에서 PricingSheet의 "배치 편집" 스위치로
          켠다. 이 Provider는 DOM에 아무것도 그리지 않으므로(Context.Provider만)
          absolute 위치를 쓰는 자식들의 배치에 영향을 주지 않는다. */}
      <LayoutEditProvider ownerToken={ownerToken}>
      {/* [왜 — 2026-11-06 "메뉴를 옆으로 이동하니 화면에서 짤린다"] overflow-hidden은
          원래 main에 있었다 — 평소에는 꼭 필요하다(스크롤바가 생기지 않게). 그런데
          편집 모드에서 요소를 화면 가장자리 쪽으로 끌면, 다 끌어다 놓기도 전에
          그 경계에 걸쳐 보이지도 않게 잘려 나가 "짤리면서 이동된다"로 보였다.
          편집 중에만 이 경계를 풀어(ClippedViewport) 어디로 끌든 전부 보이게
          하고, 편집이 끝나면 다시 평소처럼 잘라 손님 화면은 그대로 둔다. */}
      <ClippedViewport>
      {/* 무대 — 화면 전체가 뷰파인더이자 사진 뷰어다. */}
      <CanvasStage
        photoUrl={stagePhotoUrl}
        onCapture={setPhoto}
        onRetake={() => setPhoto(null)}
        showCapture={step === 1}
        cameraOpen={cameraOpen}
        onCameraOpenChange={setCameraOpen}
      />

      {/* 떠 있는 앱 바 */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4">
        <Movable id="header-left" className="flex shrink-0 items-center gap-2">
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
          {/* [왜 — 2026-11-06 "업체 표기가 따로 떠 있으니 안 예쁘다, 메뉴 안에
              넣어줘"] 전에는 앱 바 밖에 따로 뜬 구석 워터마크였다 — 앱 바(메뉴)
              안으로 옮겨 같은 유리 알약 줄의 일부가 되게 한다(3초 길게 누르면
              단가 설정은 그대로). 견적 결과 화면(3단계)은 영수증 안에 이미 같은
              뱃지가 있어 겹치지 않게 여기서는 숨긴다. */}
          {step !== 3 && <BusinessBadge onSecretHold={() => setPricingOpen(true)} />}
        </Movable>

        {/* 아이콘이 많아지면(사장님 기기는 최대 7개) 일반폭 폰에서 뒤쪽 아이콘이
            화면 밖으로 밀려 안 보이던 문제가 있었다 — 가로 스크롤로 전부 닿게 한다. */}
        <Movable id="header-icons" className="no-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
          <Link
            href="/quote"
            aria-label="빠른 견적 (평수별·품목별)"
            className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Calculator className="h-5 w-5" />
          </Link>
          <Link
            href="/cutting"
            aria-label="스마트 재단 계산기"
            className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Ruler className="h-5 w-5" />
          </Link>
          <Link
            href="/blog"
            aria-label="시공 후기 블로그"
            className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Newspaper className="h-5 w-5" />
          </Link>
          <Link
            href="/portfolio"
            aria-label="시공 갤러리"
            className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Images className="h-5 w-5" />
          </Link>
          <Link
            href="/community"
            aria-label="견적 공유"
            className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Users className="h-5 w-5" />
          </Link>
          {/* 자동화 작업·현장 실습 매칭 — 예전에는 1단계(사진 찍기 전) 패널 맨
              아래에만 있던 바로가기였다. 패널이 사진을 덮지 않게 줄이면서(아래
              glass-panel 경계 참고) 그 자리가 사라졌으니, 다른 아이콘들과 같은
              줄로 올려 화면 상태와 무관하게 항상 닿을 수 있게 한다. */}
          <Link
            href="/automation"
            aria-label="자동화 작업"
            className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Bot className="h-5 w-5" />
          </Link>
          <Link
            href="/recruiting"
            aria-label="현장 실습 매칭"
            className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
          >
            <Briefcase className="h-5 w-5" />
          </Link>
          {/* 견적서 목록은 고객 이름·금액이 들어 있는 사장님 전용 자료라 사장님
              기기에만 보여준다. */}
          {ownerToken && (
            <button
              type="button"
              onClick={() => setQuoteDialogOpen(true)}
              aria-label="견적서 불러오기"
              className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
            >
              <FolderOpen className="h-5 w-5" />
            </button>
          )}
          {/* 완료된 견적 없이도(사진 한 장만으로) 바로 만들 수 있는 독립 생성 경로 —
              job에 묶인 경로(SitePhotoGallery 안의 버튼)와 별개로 여기서도 들어갈 수 있다. */}
          {ownerToken && (
            <Link
              href="/proposal/new"
              aria-label="AI 제안서 만들기"
              className="glass-pill flex h-11 w-11 shrink-0 items-center justify-center text-slate-700 transition-transform active:scale-90"
            >
              <Sparkles className="h-5 w-5" />
            </Link>
          )}
        </Movable>
      </header>


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
           없으면 결과 패널의 마지막 내용이 그 알약 밑에 깔려 눌리지 않는다.

           [펼친 화면(가로)에서 스크롤이 안 먹던 원인]
           SimulationPanel은 펼친 화면에서 왼쪽(사진)·오른쪽(견적) 두 칸으로 갈라지고
           각 칸이 foldLandscape:overflow-y-auto로 "따로" 스크롤된다. 그런데 이 바깥
           section에도 overflow-y-auto가 그대로 남아 있어서, 같은 화면에 스크롤 가능한
           영역이 이중으로 겹쳤다 — 손가락으로 안쪽 칸(사진·견적)을 쓸어 올려도, 터치가
           안쪽 칸으로 갈지 바깥 section으로 갈지 애매해지면서 실기기에서 스크롤 제스처
           자체가 먹히지 않았다(스크립트로 scrollTop을 직접 바꾸면 되는데 손가락 제스처만
           안 먹힌 이유 — 제스처 인식이 꼬인 것이지 스크롤 자체가 막힌 게 아니었다).
           세로 화면은 안쪽 두 칸이 나뉘지 않고 한 덩어리로 이어지므로(foldLandscape 전용
           클래스라 세로에선 적용 안 됨) 바깥 section 하나만 스크롤되는 게 맞다. 그래서
           가로일 때만 바깥 section의 overflow를 꺼서, 스크롤 주인을 안쪽 두 칸으로
           완전히 넘긴다. */
        <section className="absolute inset-x-3 bottom-3 top-20 z-10 overflow-y-auto rounded-3xl pb-24 foldLandscape:flex foldLandscape:flex-col foldLandscape:inset-y-4 foldLandscape:left-4 foldLandscape:right-4 foldLandscape:top-20 foldLandscape:overflow-y-visible foldLandscape:pb-4">
          {/* [가로 화면에서 h-full이 바깥으로 삐져나오던 부분]
              SimulationPanel은 foldLandscape:h-full로 "부모 높이의 100%"를 쓴다. 이
              배너들이 SimulationPanel보다 먼저 같은 section 안에 쌓이는 형제인데, section
              자체가 flex 컨테이너가 아니면 SimulationPanel의 100%는 배너 높이를 빼지 않은
              채로 계산돼 그만큼 section 밖으로 넘친다. foldLandscape:flex-col로 바꾸고
              배너는 shrink-0, SimulationPanel 자리는 flex-1 min-h-0으로 주면 100%가
              배너를 뺀 "진짜 남은 공간" 기준으로 계산된다(세로 화면은 flex가 아니므로
              영향 없음 — 원래대로 전체가 한 덩어리로 스크롤된다). */}
          <div className="foldLandscape:shrink-0">
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
          </div>
          <div className="foldLandscape:min-h-0 foldLandscape:flex-1">
            {job ? (
              <SimulationPanel job={job} ownerToken={ownerToken} onSecretHold={() => setPricingOpen(true)} />
            ) : (
              <div className="glass-panel flex h-full flex-col items-center justify-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
                <p className="text-[15px] font-light text-slate-600">견적을 준비하는 중입니다...</p>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* 조작 패널 — 화면을 반으로 가르지 않고, 여백을 두고 떠 있다.
           [왜 1단계만 완전히 다른 모양인가 — 2026-11-05 "현장등록 UI가 메인사진을
           덮는다" / "비율을 더 줄여줘"]
           1단계(현장 등록)는 고객명 한 줄만 받는 가벼운 패널인데도 2단계(품목·옵션
           선택, 내용이 훨씬 많아 스크롤이 필요한 단계)와 같은 "화면의 몇 %" 높이
           고정 방식을 썼다 — 내용이 적어도 항상 그만큼 사진을 덮었다. 1단계는
           아예 높이를 %로 고정하지 않고 top을 비워 내용 높이만큼만 차지하게
           한다(bottom만 지정된 절대 위치는 콘텐츠 높이에 맞춰 줄어든다) — 고객명
           한 줄 + 버튼만큼의 작은 카드로 줄어, 화면 대부분이 사진으로 남는다.
           가로(펼친 화면)에서도 같은 원칙으로 오른쪽 아래에 작게 떠 있게 해서,
           세로·가로 어느 쪽이든 "필요한 만큼만 차지하는 카드"라는 같은 디자인
           언어를 쓴다(예전엔 가로에서만 항상 전체 높이 패널이라 두 화면이 서로
           다른 제품처럼 보였다). 2단계는 내용이 많아 그대로 둔다. */
        <MovableAbsolute
          id="main-panel"
          as="section"
          className={
            step === 1
              ? "glass-panel absolute inset-x-4 bottom-4 z-10 flex flex-col " +
                "foldLandscape:inset-x-auto foldLandscape:right-6 foldLandscape:bottom-8 foldLandscape:w-[380px]"
              : "glass-panel absolute inset-x-3 bottom-3 top-[38%] z-10 flex flex-col " +
                "foldLandscape:inset-y-4 foldLandscape:left-auto foldLandscape:right-4 foldLandscape:top-20 foldLandscape:w-[420px]"
          }
        >
          {/* 유리 패널이라는 신호 — BottomSheet와 같은 손잡이 표시. 내용 높이만큼만
              차지하는 1단계 작은 카드(세로·가로 모두)에는 "쓸어내려 닫는 시트"라는
              손짓 신호가 어울리지 않고, 빈 자리만큼 카드가 커져 버리므로 2단계
              세로 화면에서만 보인다. */}
          {step === 2 && (
            <div className="flex shrink-0 justify-center pb-1 pt-3 foldLandscape:hidden">
              <div className="h-1.5 w-11 rounded-full bg-slate-900/20" />
            </div>
          )}
          <div className={`min-h-0 flex-1 overflow-y-auto ${step === 1 ? "px-6 pb-1 pt-6" : "px-7 pb-5 pt-3"}`}>
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
                <StepMapping autoDescription={autoDescription} onAutoDescriptionChange={setAutoDescription} />
                {/* 견적 금액은 항목별 수량으로 계산되므로 항상 받는다. */}
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
          <div className={`shrink-0 ${step === 1 ? "px-6 pb-6 pt-3" : "px-7 pb-7 pt-2"}`}>
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
            {/* [왜 2026-11-05에 "사진 없이 빠른 견적 보기"·"자동화 작업"·"현장 실습
                매칭" 세 바로가기를 뺐는가] 이 패널이 1단계에서 화면의 62%를 덮어
                대표 사진을 가리는 원인이었다(위 top-[55%] 메모 참고). 셋 다 위
                앱 바 아이콘 줄로 옮겨(빠른 견적은 이미 Calculator 아이콘으로
                있었다 — 중복이었던 것) 패널에는 꼭 필요한 "현장 등록" 흐름만
                남긴다. */}
            {step === 1 && !photo && (
              <p className="pt-3 text-center text-[12px] font-light text-slate-400">
                현장 사진을 촬영하면 다음으로 넘어갑니다
              </p>
            )}
          </div>
        </MovableAbsolute>
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

      <FeatureIntroDialog open={featureIntroOpen} onClose={dismissFeatureIntro} />

      <PricingSheet open={pricingOpen} onClose={() => setPricingOpen(false)} ownerToken={ownerToken} />

      <QuoteListDialog
        open={quoteDialogOpen}
        onClose={() => setQuoteDialogOpen(false)}
        onSelect={handleLoadQuote}
        ownerToken={ownerToken ?? ""}
      />

      </ClippedViewport>
      <EditModeBar />
      </LayoutEditProvider>
    </main>
  );
}

/** 이미 position:absolute로 직접 떠 있는 요소(뱃지·패널)에 배치 편집을 입힌다 —
 *  Movable처럼 감싸는 div에 position:relative를 더하면 그 요소 자신의 absolute
 *  기준이 감싸는 div로 뒤바뀌어 레이아웃이 깨진다(Movable.tsx 상단 메모 참고).
 *  이 요소는 자기 자신이 이미 위치 기준이므로 그 자리에 style·핸들러·편집
 *  손잡이만 얹는다. */
function MovableAbsolute({
  id,
  as = "div",
  className,
  children,
}: {
  id: string;
  as?: "div" | "section";
  className: string;
  children: React.ReactNode;
}) {
  const { style, handlers, overlay } = useMovable(id);
  const Component = as;
  return (
    <Component className={className} style={style} {...handlers}>
      {children}
      {overlay}
    </Component>
  );
}

/** main이 지던 "화면 밖으로 안 나가게 자르기" 역할을 대신 진다 — 평소에는
 *  그대로 자르고, 배치 편집 중에는 풀어서 요소를 끌 때 가장자리에서 잘려
 *  보이지 않게 한다(위 main 주석 참고). */
function ClippedViewport({ children }: { children: React.ReactNode }) {
  const { editMode } = useLayoutEdit();
  return <div className={`absolute inset-0 ${editMode ? "" : "overflow-hidden"}`}>{children}</div>;
}

/** 편집 모드가 켜져 있을 때만 뜨는 하단 알림 바 — "지금 배치를 옮기는 중"이라는
 *  상태를 분명히 하고, 빠져나갈 길(완료)을 준다. */
function EditModeBar() {
  const { editMode, setEditMode } = useLayoutEdit();
  if (!editMode) return null;
  return (
    <div className="glass-pill fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 px-5 py-3 shadow-xl">
      <span className="whitespace-nowrap text-[13px] font-semibold text-indigo-700">
        배치 편집 중 · 길게 눌러 옮기기
      </span>
      <button
        type="button"
        onClick={() => setEditMode(false)}
        className="shrink-0 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-bold text-white transition-transform active:scale-95"
      >
        완료
      </button>
    </div>
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
          ? // [왜 2026-11-05에 text-slate-400 → text-black으로 바꿨는가] 패널이
            // 더 투명해지면서(globals.css) 원래도 옅었던 비활성 글씨("다음")가
            // 거의 안 보일 정도로 흐려졌다는 요청이 있었다. 사진을 찍기 전에도
            // "다음" 글씨 자체는 또렷하게 읽혀야 한다.
            "bg-black/5 font-bold text-black"
          : "bg-indigo-600 font-semibold text-white shadow-[0_10px_40px_rgba(79,70,229,0.45)]"
      }`}
    >
      {children}
    </button>
  );
}
