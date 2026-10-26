"use client";

import { useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";

interface Props {
  /** 찍어 둔 견본 사진(data URL). 없으면 "찍기" 버튼만 보인다. */
  value?: string;
  onChange: (value: string | undefined) => void;
  label?: string;
}

/** 사진 파일을 data URL로 읽는다. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

/** [실제 필름 견본 사진으로 색·질감 맞추기]
 *
 *  색상 칩(카탈로그 색상 id)은 화면 밝기·설정에 따라 실제 자재와 다르게 보일 수
 *  있고, AI도 "매트 화이트" 같은 이름만으로는 정확한 색을 못 맞춘다. 가진 필름
 *  견본을 그 자리에서 찍으면, 그 사진을 AI에게 "이 자재와 똑같이" 입히라는
 *  참고 이미지로 그대로 넘긴다 — 카탈로그 이름보다 훨씬 사실적인 결과가 나온다.
 *
 *  MaterialPicker(수동 모드, 사진에 직접 영역을 그려 자재를 고르는 화면)에
 *  처음 만든 것과 같은 UI를 여기서는 시공 항목(StepItems) 화면의 색상/패턴
 *  칸에서도 쓸 수 있게 재사용 가능한 컴포넌트로 뽑아냈다 — 두 화면이 서로
 *  다른 로직으로 갈라지면 한쪽만 고치고 다른 쪽을 잊는 사고가 난다. */
export default function SwatchPhotoField({ value, onChange, label = "실제 필름 견본 사진 (추천)" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await readFileAsDataUrl(file));
    } catch {
      // 못 읽으면 조용히 포기 — 다시 누르거나 색상 칩을 그대로 쓰면 된다.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {value ? (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="견본 사진" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
          <p className="flex-1 text-[12px] font-semibold leading-snug text-indigo-700">
            이 견본 사진 그대로 입혀요
          </p>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label="견본 사진 다시 찍기"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm transition-transform active:scale-90"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 text-[12px] font-semibold text-indigo-600 transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <Camera className="h-4 w-4" />
          {busy ? "불러오는 중..." : "견본 사진 찍기 · 올리기"}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </div>
  );
}
