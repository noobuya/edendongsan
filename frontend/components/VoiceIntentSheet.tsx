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

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: { [i: number]: { [i: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const SPEECH_ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "마이크 권한이 꺼져 있어요. 브라우저 주소창의 자물쇠 아이콘에서 마이크를 허용해 주세요.",
  "service-not-allowed": "이 브라우저/앱에서는 음성 인식 서비스를 쓸 수 없어요. 아래 입력칸에서 키보드의 마이크 버튼을 눌러 말씀해 주세요.",
  "no-speech": "말소리를 듣지 못했어요. 버튼을 다시 눌러 말씀해 주세요.",
  "audio-capture": "마이크를 찾을 수 없어요. 기기의 마이크 연결을 확인해 주세요.",
  "network": "네트워크 문제로 음성 인식에 실패했어요. 다시 시도해 주세요.",
};

/** 안드로이드/아이폰 키보드에는 전부 마이크(받아쓰기) 버튼이 있어, 아래 입력칸에
 *  그대로 대고 말하면 된다 — 그게 이 화면의 기본 "마이크 기능"이고 추가 구현이
 *  필요 없다. Web Speech API를 지원하는 브라우저(데스크톱 크롬 등)에서만 "탭해서
 *  말하기" 보조 버튼을 하나 더 보여준다.
 *
 *  [버튼은 보이는데 눌러도 아무 반응이 없던 문제 — 2026-11]
 *  일부 브라우저/웹뷰는 webkitSpeechRecognition 생성자 자체는 있지만(그래서
 *  "지원함"으로 잘못 판정됨) 실제로 start()를 부르면 권한이 없거나 음성 인식
 *  서비스에 연결하지 못해 즉시 또는 조용히 실패한다. 예전엔 이 실패를 그냥
 *  삼키고 버튼만 원래 모양으로 되돌려서, 사용자 눈에는 "눌렀는데 아무 일도
 *  안 일어난다"로만 보였다. 이제 (1) start() 자체가 동기적으로 던지는 경우까지
 *  try/catch로 잡고, (2) onerror에서 실제 이유를 한국어 안내로 보여주고,
 *  (3) 10초 안에 끝나거나 결과가 없으면 "듣는 중" 표시를 강제로 풀어, 버튼이
 *  영원히 빨갛게 멈춰 있는 일이 없게 한다. */
function useSpeechRecognition(onResult: (text: string) => void, onError: (message: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    };
  }, []);

  function clearStuckTimer() {
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
  }

  function start() {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const recognition = new Ctor();
      recognition.lang = "ko-KR";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (e) => {
        const text = e.results?.[0]?.[0]?.transcript ?? "";
        if (text) onResult(text);
      };
      recognition.onend = () => {
        clearStuckTimer();
        setListening(false);
      };
      recognition.onerror = (e) => {
        clearStuckTimer();
        setListening(false);
        onError(
          (e.error && SPEECH_ERROR_MESSAGES[e.error]) ||
            "음성 인식에 실패했어요. 아래 입력칸에서 키보드의 마이크 버튼을 써 보세요."
        );
      };
      recognitionRef.current = recognition;
      setListening(true);
      recognition.start();
      // 권한 프롬프트가 뜨지도 않고 onend/onerror도 안 오는 드문 경우를 대비한 안전장치.
      stuckTimerRef.current = setTimeout(() => {
        recognitionRef.current?.stop();
        setListening(false);
      }, 10_000);
    } catch {
      setListening(false);
      onError("이 브라우저/앱에서는 음성 인식 버튼을 쓸 수 없어요. 아래 입력칸에서 키보드의 마이크 버튼을 써 보세요.");
    }
  }

  function stop() {
    recognitionRef.current?.stop();
    clearStuckTimer();
    setListening(false);
  }

  return { supported, listening, start, stop };
}

export default function VoiceIntentSheet({ open, onClose, onApply, onUsePickerInstead }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speech = useSpeechRecognition(
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
          {speech.supported && (
            <button
              type="button"
              onClick={speech.listening ? speech.stop : speech.start}
              aria-label="탭해서 말하기"
              className={`absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                speech.listening ? "animate-pulse bg-rose-500 text-white" : "bg-indigo-50 text-indigo-600"
              }`}
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
        </div>
        <p className="-mt-2 px-1 text-[12px] font-light text-slate-400">
          입력칸을 누르고 키보드에 있는 마이크 버튼으로도 말할 수 있어요.
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
