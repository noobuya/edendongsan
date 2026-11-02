"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, Download, FileText, Film, Loader2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import {
  buildNaverSteps,
  buildStepPng,
  copyNaverStep,
  saveCompareGif,
  stepImageKey,
  type NaverExportPost,
} from "@/lib/naverBlogExport";

/** 글 → 사진1 → 사진2 … 를 하나씩 클립보드에 넣고, 사장님이 네이버 글쓰기 화면에서
 *  Ctrl+V 하는 흐름. 사진은 "파일"로 들어가서 네이버가 확실히 업로드한다
 *  (lib/naverBlogExport.ts의 "한 단계씩 복사" 주석 참고). */
export default function NaverStepCopyPanel({ post }: { post: NaverExportPost }) {
  const steps = useMemo(() => buildNaverSteps(post), [post]);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [copying, setCopying] = useState<number | null>(null);
  const [gifSaving, setGifSaving] = useState<number | null>(null);
  const [gifDone, setGifDone] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // 패널을 여는 순간 사진을 전부 PNG로 미리 만들어 둔다 — 버튼을 누른 뒤에 만들기
  // 시작하면 그사이 브라우저의 "방금 누름" 허용이 풀려 복사가 거부될 수 있다.
  const pngs = useRef(new Map<string, Promise<Blob>>());

  useEffect(() => {
    for (const step of steps) {
      const key = stepImageKey(step);
      if (key && !pngs.current.has(key)) {
        const p = buildStepPng(step);
        if (!p) continue;
        p.catch(() => undefined); // 실패는 그 단계를 누를 때 보여준다
        pngs.current.set(key, p);
      }
    }
  }, [steps]);

  const next = steps.findIndex((_, i) => !done.has(i));
  // 순서표 i번째 줄이 몇 번째 비교 사진인지(파일 이름 번호용)
  const pairIndex = (i: number) => steps.slice(0, i).filter((st) => st.kind === "pair").length;

  async function handleCopy(index: number) {
    const step = steps[index];
    setCopying(index);
    setError(null);
    try {
      const key = stepImageKey(step);
      await copyNaverStep(step, key ? pngs.current.get(key) : undefined);
      setDone((prev) => new Set(prev).add(index));
    } catch (err) {
      setError(err instanceof Error ? err.message : "복사하지 못했습니다.");
    } finally {
      setCopying(null);
    }
  }

  async function handleGif(index: number, url: string, pairNo: number, format: "gif" | "mp4") {
    const key = format === "mp4" ? index + 10_000 : index;
    setGifSaving(key);
    setError(null);
    try {
      await saveCompareGif(url, pairNo, format);
      setGifDone((prev) => new Set(prev).add(key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "움짤을 저장하지 못했습니다.");
    } finally {
      setGifSaving(null);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs leading-relaxed text-slate-600">
        <b>1번 [복사]</b> 한 번이면 제목·본문·해시태그 <b>글 전체</b>가 들어가요(네이버 글쓰기 화면에서 <b>Ctrl+V</b>).
        네이버는 붙여넣은 글 속 사진은 받지 않아서, 사진은 그 아래 줄부터 하나씩 [복사] → Ctrl+V 하세요. 사진은
        파일로 붙여넣어져 바로 올라갑니다. 영상은 [저장] 후 네이버의 <b>[동영상]</b> 버튼으로 올리세요. 비교 사진 줄의 <b>[움짤]</b>은 가운데 선이 저절로 움직이는 GIF(네이버 <b>[사진]</b> 버튼으로), <b>[영상]</b>은 같은 장면의 짧은 MP4(네이버 <b>[동영상]</b> 버튼으로)예요 — 움짤이 안 올라가면 영상을 쓰세요(손으로 미는 슬라이더는 네이버가 지원하지 않아요).
      </p>
      <ol className="space-y-1.5">
        {steps.map((step, i) => {
          const isDone = done.has(i);
          const isNext = i === next;
          return (
            <li
              key={i}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                isNext ? "bg-emerald-50 ring-1 ring-emerald-200" : ""
              }`}
            >
              <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-400">{i + 1}</span>
              {step.kind === "photo" ? (
                <AssetImage src={step.url} alt={step.label} className="h-10 w-10 shrink-0 rounded object-cover" />
              ) : step.kind === "video" ? (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-900">
                  <Film className="h-4 w-4 text-white" />
                </span>
              ) : step.kind === "pair" ? (
                <span className="flex h-10 w-10 shrink-0 gap-px overflow-hidden rounded">
                  <AssetImage src={step.before} alt="시공 전" className="h-10 w-5 object-cover" />
                  <AssetImage src={step.after} alt="시공 후" className="h-10 w-5 object-cover" />
                </span>
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100">
                  <FileText className="h-4 w-4 text-slate-500" />
                </span>
              )}
              <span className={`flex-1 text-[13px] ${isDone ? "text-slate-400" : "text-slate-700"}`}>{step.label}</span>
              {step.kind === "pair" && step.gifUrl && (
                <>
                  {(["gif", "mp4"] as const).map((format) => {
                    const key = format === "mp4" ? i + 10_000 : i;
                    return (
                      <button
                        key={format}
                        type="button"
                        onClick={() => handleGif(i, step.gifUrl!, pairIndex(i) + 1, format)}
                        disabled={gifSaving !== null}
                        title={
                          format === "gif"
                            ? "선이 저절로 좌우로 움직이는 비교 사진 — 저장 후 네이버 [사진] 버튼으로"
                            : "같은 장면의 짧은 영상 — GIF가 안 올라가면 이걸 네이버 [동영상] 버튼으로"
                        }
                        className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 transition active:scale-95 disabled:opacity-60"
                      >
                        {gifSaving === key ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : gifDone.has(key) ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Film className="h-3 w-3" />
                        )}
                        {format === "gif" ? "움짤" : "영상"}
                      </button>
                    );
                  })}
                </>
              )}
              <button
                type="button"
                onClick={() => handleCopy(i)}
                disabled={copying !== null}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95 disabled:opacity-60 ${
                  isDone
                    ? "bg-slate-100 text-slate-500"
                    : isNext
                      ? "bg-[#03c75a] text-white"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                {copying === i ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isDone ? (
                  <Check className="h-3 w-3" />
                ) : step.kind === "video" ? (
                  <Download className="h-3 w-3" />
                ) : (
                  <ClipboardCopy className="h-3 w-3" />
                )}
                {step.kind === "video" ? (isDone ? "저장함" : "저장") : isDone ? "복사함" : "복사"}
              </button>
            </li>
          );
        })}
      </ol>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {next === -1 && <p className="text-xs text-emerald-700">모두 복사했어요. 네이버에서 발행만 하시면 됩니다.</p>}
    </div>
  );
}
