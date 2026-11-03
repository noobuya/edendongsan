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
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** 안드로이드/아이폰 키보드에는 전부 마이크(받아쓰기) 버튼이 있어, 아래 입력칸에
 *  그대로 대고 말하면 된다 — 그게 이 화면의 기본 "마이크 기능"이고 추가 구현이
 *  필요 없다. Web Speech API를 지원하는 데스크톱 브라우저(크롬 등)에서만 "탭해서
 *  말하기" 보조 버튼을 하나 더 보여준다 — 지원하지 않는 환경(설치된 앱의 WebView,
 *  iOS Safari 등)에서는 조용히 숨긴다(BrandHero.useBrandImageSrc와 같은 "있으면
 *  쓰고 없으면 티 안 내고 빠진다" 패턴). */
function useSpeechRecognition(onResult: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function start() {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript ?? "";
      if (text) onResult(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return { supported, listening, start, stop };
}

export default function VoiceIntentSheet({ open, onClose, onApply, onUsePickerInstead }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speech = useSpeechRecognition((heard) => setText((prev) => (prev ? `${prev} ${heard}` : heard)));

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
