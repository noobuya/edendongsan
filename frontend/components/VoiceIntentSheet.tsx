"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Mic, Sparkles } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import { parseConstructionIntent } from "@/lib/api";
import type { ConstructionIntentResult } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 이해한 항목·초안 치수를 전달한다. 부모(StepItems)가 selectedItems/options에 merge한다. */
  onApply: (result: ConstructionIntentResult) => void;
  /** "직접 선택할게요" — 기존 ItemPickerSheet로 넘어간다. */
  onUsePickerInstead: () => void;
}

const EXAMPLES = [
  "30평대 싱크대 상하부장과 아일랜드를 시공할거다",
  "옷장을 시공할거다",
  "문짝과 문틀을 시공할거다",
];

// Web Speech API는 표준 TS lib에 타입이 없어(브라우저별 구현이라 미표준) 최소한만 직접 선언한다.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: SpeechRecognitionResultLike[];
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const SPEECH_ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "마이크 권한이 꺼져 있어요. 브라우저/앱 설정에서 마이크 권한을 켜주세요.",
  "service-not-allowed": "이 브라우저에서는 음성 인식 서비스를 쓸 수 없어요.",
  "no-speech": "말소리를 듣지 못했어요. 다시 눌러서 말씀해 주세요.",
  "audio-capture": "마이크를 찾을 수 없어요. 기기의 마이크 연결을 확인해 주세요.",
  network: "네트워크 문제로 음성 인식에 실패했어요. 다시 시도해 주세요.",
};

const VOICE_TIMEOUT_MS = 12_000;

/** [APK에서 음성 인식이 "눌러도 반응 없다"던 문제의 진짜 원인 — 2026-11]
 *  설치된 앱은 capacitor.config.ts에서 이 서버 주소를 그대로 여는 안드로이드
 *  웹뷰(WebView)다. 웹뷰는 일반 브라우저(Chrome 앱)와 달리 Web Speech API
 *  (webkitSpeechRecognition)를 구현하지 않는다 — 생성자가 있어도(또는 없어서
 *  버튼이 숨어도) 실제로 쓸 수 없다. 키보드 자체의 받아쓰기 마이크도 웹뷰
 *  입력칸에서는 아이콘이 안 뜬다는 게 실측으로 확인됐다(이 화면만 그렇고
 *  다른 앱에서는 정상 — 웹뷰 특유의 제약).
 *
 *  그래서 OS 자체 SpeechRecognizer를 직접 쓰는 네이티브 플러그인
 *  (@capacitor-community/speech-recognition — frontend/app/cutting/page.tsx의
 *  스마트 재단 계산기에서 이미 같은 방식으로 검증된 패턴을 그대로 가져왔다)을
 *  쓴다. 설치된 앱(Capacitor.isNativePlatform())에서는 이 플러그인을, 일반
 *  웹 브라우저(PC 크롬 등)에서는 기존 Web Speech API 경로를 그대로 쓴다.
 *
 *  [주의] 이 네이티브 경로는 APK를 새로 빌드해 다시 설치해야만 실제로
 *  동작한다 — 서버 코드만 바뀌는 다른 기능과 달리, 기존에 설치된 APK에는
 *  이 플러그인이 들어있지 않다. */
function useVoiceInput(onResult: (text: string) => void, onError: (message: string) => void) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isNativeRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        isNativeRef.current = true;
        try {
          const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
          const { available } = await SpeechRecognition.available();
          if (active) setSupported(available);
        } catch {
          if (active) setSupported(false);
        }
        return;
      }
      const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
      if (active) setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    })();
    return () => {
      active = false;
      recognitionRef.current?.stop();
      if (isNativeRef.current) {
        void import("@capacitor-community/speech-recognition").then(({ SpeechRecognition }) =>
          SpeechRecognition.stop().catch(() => {})
        );
      }
    };
  }, []);

  function clearVoiceTimeout() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  async function startNative() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      try {
        const perm = await SpeechRecognition.checkPermissions();
        if (perm.speechRecognition !== "granted") {
          const requested = await SpeechRecognition.requestPermissions();
          if (requested.speechRecognition !== "granted") {
            onError("마이크 권한이 꺼져 있어요. 기기 설정 > 앱 권한에서 마이크를 켜주세요.");
            return;
          }
        }
      } catch {
        onError("마이크 권한을 확인하지 못했어요.");
        return;
      }

      setListening(true);
      clearVoiceTimeout();
      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutRef.current = setTimeout(() => resolve(null), VOICE_TIMEOUT_MS);
      });
      try {
        const result = await Promise.race([
          SpeechRecognition.start({ language: "ko-KR", popup: false, partialResults: false }),
          timeoutPromise,
        ]);
        clearVoiceTimeout();
        setListening(false);
        if (result === null) {
          await SpeechRecognition.stop().catch(() => {});
          onError("음성 인식이 응답하지 않아요. 아래 입력칸에 직접 입력해 주세요.");
          return;
        }
        const text = result.matches?.[0]?.trim();
        if (text) onResult(text);
        else onError("아무 말도 못 들었어요. 다시 눌러서 말씀해 주세요.");
      } catch {
        clearVoiceTimeout();
        setListening(false);
        onError("음성을 인식하지 못했어요. 다시 시도해 주세요.");
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function stopNative() {
    clearVoiceTimeout();
    const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
    await SpeechRecognition.stop().catch(() => {});
    setListening(false);
  }

  function startWeb() {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      onError("이 브라우저는 음성 인식을 지원하지 않아요.");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      clearVoiceTimeout();
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) onResult(text);
    };
    recognition.onerror = (event) => {
      clearVoiceTimeout();
      setListening(false);
      const code = (event as { error?: string } | undefined)?.error;
      onError((code && SPEECH_ERROR_MESSAGES[code]) || "음성을 인식하지 못했어요. 다시 시도해 주세요.");
    };
    recognition.onend = () => {
      clearVoiceTimeout();
      setListening(false);
    };
    recognitionRef.current = recognition;
    setListening(true);
    clearVoiceTimeout();
    timeoutRef.current = setTimeout(() => {
      recognitionRef.current?.stop();
      setListening(false);
      onError("음성 인식이 응답하지 않아요 — 이 기기/앱에서는 음성 명령이 안 될 수 있어요. 아래 입력칸에 직접 입력해 주세요.");
    }, VOICE_TIMEOUT_MS);
    try {
      recognition.start();
    } catch {
      clearVoiceTimeout();
      setListening(false);
      onError("음성 인식을 시작하지 못했어요.");
    }
  }
  function stopWeb() {
    clearVoiceTimeout();
    recognitionRef.current?.stop();
    setListening(false);
  }

  function start() {
    if (isNativeRef.current) void startNative();
    else startWeb();
  }
  function stop() {
    if (isNativeRef.current) void stopNative();
    else stopWeb();
  }

  return { supported, listening, start, stop };
}

export default function VoiceIntentSheet({ open, onClose, onApply, onUsePickerInstead }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speech = useVoiceInput(
    (heard) => setText((prev) => (prev ? `${prev} ${heard}` : heard)),
    (message) => setError(message)
  );

  useEffect(() => {
    if (open) return;
    setText("");
    setError(null);
    setBusy(false);
  }, [open]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await parseConstructionIntent(trimmed);
      if (result.unclear_note || result.items.length === 0) {
        setError("말씀하신 내용을 이해하지 못했어요. 다르게 말씀해 주시거나, 아래에서 직접 선택해 주세요.");
        return;
      }
      onApply(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="말로 설명해 주세요"
      description="어떤 시공인지 말씀하시면, 사진에서 AI가 알아서 영역을 찾아 시공합니다"
    >
      <div className="space-y-4">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`예: ${EXAMPLES[0]}`}
            rows={4}
            autoFocus
            className="w-full resize-none rounded-2xl border border-slate-200 bg-white p-4 pr-14 text-[16px] text-slate-900 outline-none focus:border-indigo-500"
          />
          {/* 지원 여부와 무관하게 버튼은 항상 보여준다 — 숨기면 사용자 눈에는
              "마이크가 아예 없다"로 보인다. 지원하지 않으면 눌렀을 때 바로
              이유를 알려준다. */}
          <button
            type="button"
            onClick={() => {
              if (!speech.supported) {
                setError("이 기기에서는 음성 인식을 쓸 수 없어요. 아래 입력칸에 직접 입력해 주세요.");
                return;
              }
              speech.listening ? speech.stop() : speech.start();
            }}
            aria-label="탭해서 말하기"
            className={`absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
              speech.listening ? "animate-pulse bg-rose-500 text-white" : "bg-indigo-50 text-indigo-600"
            }`}
          >
            <Mic className="h-5 w-5" />
          </button>
        </div>
        <p className="-mt-2 px-1 text-[12px] font-light text-slate-400">
          오른쪽 마이크 버튼을 눌러 말씀하시거나, 입력칸에 직접 타이핑해도 됩니다.
        </p>

        <div className="space-y-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="block w-full truncate rounded-xl bg-slate-50 px-3 py-2 text-left text-[13px] text-slate-500 transition-colors active:bg-slate-100"
            >
              &quot;{ex}&quot;
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={submit}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-indigo-600 text-[15px] font-bold text-white shadow-[0_10px_40px_rgba(79,70,229,0.45)] transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          AI에게 전달하기
        </button>

        <button
          type="button"
          onClick={onUsePickerInstead}
          className="block w-full text-center text-[13px] font-semibold text-slate-400 underline underline-offset-2"
        >
          직접 선택할게요
        </button>
      </div>
    </BottomSheet>
  );
}
