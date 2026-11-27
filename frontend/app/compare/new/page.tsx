"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, Loader2, Plus, Send, Trash2 } from "lucide-react";
import {
  checkOwnerToken,
  createComparisonBoard,
  publishComparisonBoard,
  resolveAssetUrl,
  type ComparisonAreaInput,
} from "@/lib/api";
import { readOwnerToken, saveOwnerToken } from "@/lib/ownerToken";
import { ALL_PATTERN_SWATCHES } from "@/lib/patternSwatches";
import { shareOrDownloadFile } from "@/lib/shareMedia";
import { useAndroidBack } from "@/lib/useAndroidBack";
import type { ComparisonBoard } from "@/types";

interface OptionDraft {
  label: string;
  caption: string;
  priceNote: string;
  filmName: string;
  file: File | null;
  previewUrl: string;
}

interface AreaDraft {
  label: string;
  beforeFile: File | null;
  beforePreviewUrl: string;
  options: OptionDraft[];
}

function emptyOption(): OptionDraft {
  return { label: "", caption: "", priceNote: "", filmName: "", file: null, previewUrl: "" };
}

function emptyArea(): AreaDraft {
  return { label: "", beforeFile: null, beforePreviewUrl: "", options: [emptyOption()] };
}

/** "부위 이름"은 원래부터 자유 입력이라 주방 싱크대·진열장 말고 무엇이든 적을 수
 *  있었지만(제한 없음), 사장님이 실제로 시공하는 품목 전부를 빠르게 고를 수 있게
 *  lib/workItems.ts(시공 항목 정의)·chat-quote 프리셋과 같은 이름으로 빠른 선택
 *  칩을 둔다 — 타이핑 없이도 "우리가 가지고 있는 모든 품목"이 가능함을 바로 보여준다. */
const COMMON_AREA_LABELS = [
  "싱크대 상부장",
  "싱크대 하부장",
  "아일랜드 식탁",
  "냉장고장",
  "펜트리장",
  "신발장",
  "붙박이장(옷장)",
  "방문",
  "문틀",
  "현관문",
  "샷시",
  "벽면",
  "걸레받이/몰딩",
  "사각 싱크볼",
  "욕실 변기",
  "다운라이트(조명)",
  "실링팬",
  "유리 썬팅",
  "미세방충망",
  "콩자갈 바닥",
  "장식장/진열장",
  "가구(의자·책상 등)",
];

/** 필름 이름 입력칸의 자동완성 후보 — 앱이 이미 쓰는 실제 자재 카탈로그
 *  (lib/patternSwatches.ts, FilmForm의 SwatchPicker와 같은 목록)에서 그대로
 *  가져온다. 품번이 있는 제품은 "이름 (브랜드 코드)"로 보여줘 발주서와 바로
 *  맞춰볼 수 있게 한다. */
const FILM_NAME_SUGGESTIONS = ALL_PATTERN_SWATCHES.map((p) => (p.code ? `${p.name} (${p.brand} ${p.code})` : p.name));

/** 사장님 전용 — AI 가상시공 비교판 만들기. 시공전 사진(부위별 여러 장)과
 *  외부 AI(Gemini 등)로 미리 만들어 둔 시공후 옵션 사진(올화이트/투톤 등)들을
 *  올리면, 한 장의 제안서 이미지(BEFORE/AFTER 격자 비교판)로 합성해 준다.
 *  완성되면 이미지·비교영상을 카톡/문자로 바로 보내거나(navigator.share),
 *  고객 전용 링크로 발행해서 보낼 수도 있다 — 둘 다 지원(사장님 요청). */
export default function NewComparisonBoardPage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenChecking, setTokenChecking] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [priceNote, setPriceNote] = useState("");
  const [areas, setAreas] = useState<AreaDraft[]>([emptyArea()]);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<ComparisonBoard | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setOwnerToken(readOwnerToken());
  }, []);

  async function handleTokenSubmit() {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    setTokenChecking(true);
    setTokenError(null);
    try {
      const result = await checkOwnerToken(trimmed);
      if (result === "ok") {
        saveOwnerToken(trimmed);
        setOwnerToken(trimmed);
      } else if (result === "rejected") {
        setTokenError("토큰이 올바르지 않아요.");
      } else {
        setTokenError("서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setTokenChecking(false);
    }
  }

  function updateArea(index: number, patch: Partial<AreaDraft>) {
    setAreas((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }
  function updateOption(areaIndex: number, optIndex: number, patch: Partial<OptionDraft>) {
    setAreas((prev) =>
      prev.map((a, i) =>
        i !== areaIndex ? a : { ...a, options: a.options.map((o, j) => (j === optIndex ? { ...o, ...patch } : o)) }
      )
    );
  }

  function addArea() {
    setAreas((prev) => [...prev, emptyArea()]);
  }
  function removeArea(index: number) {
    setAreas((prev) => prev.filter((_, i) => i !== index));
  }
  function addOption(areaIndex: number) {
    setAreas((prev) =>
      prev.map((a, i) => (i !== areaIndex ? a : { ...a, options: [...a.options, emptyOption()] }))
    );
  }
  function removeOption(areaIndex: number, optIndex: number) {
    setAreas((prev) =>
      prev.map((a, i) => (i !== areaIndex ? a : { ...a, options: a.options.filter((_, j) => j !== optIndex) }))
    );
  }

  function handleBeforeFile(areaIndex: number, file: File | null) {
    updateArea(areaIndex, { beforeFile: file, beforePreviewUrl: file ? URL.createObjectURL(file) : "" });
  }
  function handleOptionFile(areaIndex: number, optIndex: number, file: File | null) {
    updateOption(areaIndex, optIndex, { file, previewUrl: file ? URL.createObjectURL(file) : "" });
  }

  const canSubmit =
    title.trim().length > 0 &&
    areas.length > 0 &&
    areas.every(
      (a) => a.label.trim() && a.beforeFile && a.options.length > 0 && a.options.every((o) => o.label.trim() && o.file)
    );

  async function handleGenerate() {
    if (!ownerToken || !canSubmit) return;
    setGenerating(true);
    setError(null);
    try {
      const layout: ComparisonAreaInput[] = areas.map((a) => ({
        label: a.label.trim(),
        options: a.options.map((o) => ({
          label: o.label.trim(),
          caption: o.caption.trim(),
          price_note: o.priceNote.trim(),
          film_name: o.filmName.trim(),
        })),
      }));
      const photos: File[] = [];
      areas.forEach((a) => {
        photos.push(a.beforeFile as File);
        a.options.forEach((o) => photos.push(o.file as File));
      });
      const created = await createComparisonBoard(title.trim(), priceNote.trim(), layout, photos, ownerToken);
      setBoard(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "비교판 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  function resetForm() {
    setBoard(null);
    setTitle("");
    setPriceNote("");
    setAreas([emptyArea()]);
    setError(null);
    setNotice(null);
  }

  async function handleSendImage() {
    if (!board) return;
    setSendingKey("image");
    setNotice(null);
    try {
      const res = await fetch(resolveAssetUrl(board.image_url));
      const blob = await res.blob();
      const file = new File([blob], "비교판.jpg", { type: "image/jpeg" });
      const result = await shareOrDownloadFile(file, { title: board.title, text: "고객님, 시공 전후 비교판입니다." });
      setNotice(
        result === "shared"
          ? null
          : result === "saved"
          ? "갤러리에 저장했어요. 채팅창의 사진 첨부 아이콘에서 찾아 보내주세요."
          : "다운로드 폴더에 저장했어요."
      );
    } catch {
      setNotice("이미지 전송에 실패했습니다.");
    } finally {
      setSendingKey(null);
    }
  }

  async function handleSendVideo(beforeId: string, afterId: string, fmt: "gif" | "mp4", label: string) {
    if (!board) return;
    const key = `${beforeId}-${afterId}-${fmt}`;
    setSendingKey(key);
    setNotice(null);
    try {
      const { comparisonVideoUrl } = await import("@/lib/api");
      const res = await fetch(comparisonVideoUrl(board.id, beforeId, afterId, fmt));
      if (!res.ok) throw new Error("비교 영상을 만들지 못했습니다.");
      const blob = await res.blob();
      const file = new File([blob], `비교영상.${fmt}`, { type: fmt === "mp4" ? "video/mp4" : "image/gif" });
      const result = await shareOrDownloadFile(file, { title: label, text: "고객님, 시공 전후 비교 영상입니다." });
      setNotice(
        result === "shared"
          ? null
          : result === "saved"
          ? "갤러리에 저장했어요. 채팅창의 사진/동영상 첨부 아이콘에서 찾아 보내주세요."
          : "다운로드 폴더에 저장했어요."
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "전송에 실패했습니다.");
    } finally {
      setSendingKey(null);
    }
  }

  async function handlePublish() {
    if (!board || !ownerToken) return;
    setPublishing(true);
    try {
      const published = await publishComparisonBoard(board.id, ownerToken);
      setBoard(published);
    } catch (err) {
      setError(err instanceof Error ? err.message : "발행에 실패했습니다.");
    } finally {
      setPublishing(false);
    }
  }

  if (ownerToken === null) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">사장님 전용 — AI 가상시공 비교판</h1>
        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[14px] text-slate-600">서버에 설정된 관리자 토큰을 입력하세요.</p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="관리자 토큰"
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && handleTokenSubmit()}
            className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none focus:border-indigo-500"
          />
          <button
            disabled={tokenChecking || !tokenInput.trim()}
            onClick={handleTokenSubmit}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white disabled:opacity-40"
          >
            {tokenChecking ? <Loader2 className="h-5 w-5 animate-spin" /> : "들어가기"}
          </button>
          {tokenError && <p className="text-[14px] font-semibold text-rose-700">{tokenError}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 px-4 py-6 pb-24">
      <datalist id="film-name-options">
        {FILM_NAME_SUGGESTIONS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <header className="flex items-center gap-2">
        <Link href="/" aria-label="처음으로" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[18px] font-bold text-slate-900">AI 가상시공 비교판</h1>
      </header>

      {!board ? (
        <section className="space-y-4">
          <div className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <div className="space-y-2 rounded-xl bg-indigo-50 px-3.5 py-3 text-[13px] leading-relaxed text-indigo-800">
              <p>
                <b>부위</b>는 싱크대·방문·샷시·욕실 등 우리가 시공하는 모든 품목을 자유롭게 적을 수 있어요(아래
                부위 카드의 빠른 선택 버튼 참고) — 주방 싱크대·진열장은 예시일 뿐, 개수 제한도 없습니다.
              </p>
              <p>
                <b>옵션</b>은 같은 부위를 색상·디자인만 바꿔서 나란히 비교하는 시안이에요(예: 올화이트 vs
                투톤). 제미나이 등 외부 AI로 미리 만들어 둔 시공후 사진을 옵션마다 하나씩 올리면, 고객이
                "A안이 좋으세요, B안이 좋으세요?" 하고 바로 고를 수 있게 비교판으로 합성해 드려요. 옵션이
                하나뿐이어도 괜찮아요(그 경우 시공후 사진 1장만 보여주는 단순 비교가 됩니다).
              </p>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목 (예: 주방 & 진열장 리모델링 고객 제안서)"
              className="h-12 w-full rounded-xl border border-slate-200 px-4 text-[15px] outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              value={priceNote}
              onChange={(e) => setPriceNote(e.target.value)}
              placeholder="가격 문구 (선택, 예: 올화이트 950만원 / 투톤 1,050만원)"
              className="h-12 w-full rounded-xl border border-slate-200 px-4 text-[14px] outline-none focus:border-indigo-500"
            />
          </div>

          {areas.map((area, areaIndex) => (
            <AreaCard
              key={areaIndex}
              area={area}
              onLabelChange={(label) => updateArea(areaIndex, { label })}
              onBeforeFile={(f) => handleBeforeFile(areaIndex, f)}
              onAddOption={() => addOption(areaIndex)}
              onRemoveOption={(optIndex) => removeOption(areaIndex, optIndex)}
              onOptionChange={(optIndex, patch) => updateOption(areaIndex, optIndex, patch)}
              onOptionFile={(optIndex, f) => handleOptionFile(areaIndex, optIndex, f)}
              onRemoveArea={areas.length > 1 ? () => removeArea(areaIndex) : undefined}
            />
          ))}

          <button
            type="button"
            onClick={addArea}
            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 text-[14px] font-semibold text-slate-500"
          >
            <Plus className="h-4 w-4" /> 부위 추가 (예: 다이닝 진열장)
          </button>

          {error && <p className="text-[13px] font-semibold text-rose-700">{error}</p>}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canSubmit || generating}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-[16px] font-bold text-white disabled:opacity-40"
          >
            {generating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> 비교판 만드는 중...
              </>
            ) : (
              "비교판 만들기"
            )}
          </button>
        </section>
      ) : (
        <section className="space-y-4">
          <div className="rounded-2xl bg-white p-3 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element -- 백엔드 결과물이라 next/image 대상이 아니다 */}
            <img src={resolveAssetUrl(board.image_url)} alt={board.title} className="w-full rounded-xl" />
          </div>

          {notice && (
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-800">{notice}</p>
          )}

          <button
            type="button"
            onClick={handleSendImage}
            disabled={sendingKey !== null}
            className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-[15px] font-bold text-white disabled:opacity-40"
          >
            {sendingKey === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            비교판 이미지 고객에게 보내기
          </button>

          <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-[13px] font-bold text-slate-500">부위별 전후 비교 영상</p>
            {board.areas.map((area) => (
              <div key={area.label} className="space-y-2 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                <p className="text-[13.5px] font-semibold text-slate-700">{area.label}</p>
                {area.options.map((opt, i) => (
                  <div key={opt.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12.5px] text-slate-500 mr-1">
                      옵션 {i + 1} ({opt.label})
                    </span>
                    <button
                      type="button"
                      disabled={sendingKey !== null}
                      onClick={() => handleSendVideo(area.before_photo.id, opt.photo.id, "gif", `${area.label} ${opt.label}`)}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
                    >
                      {sendingKey === `${area.before_photo.id}-${opt.photo.id}-gif` ? "만드는 중..." : "GIF 보내기"}
                    </button>
                    <button
                      type="button"
                      disabled={sendingKey !== null}
                      onClick={() => handleSendVideo(area.before_photo.id, opt.photo.id, "mp4", `${area.label} ${opt.label}`)}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
                    >
                      {sendingKey === `${area.before_photo.id}-${opt.photo.id}-mp4` ? "만드는 중..." : "영상 보내기"}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            {board.status === "published" ? (
              <>
                <p className="text-[13px] font-bold text-emerald-600">✓ 고객 전용 링크로 발행됨</p>
                <div className="rounded-xl bg-slate-100 px-3.5 py-3 text-[13px] text-slate-600 break-all">
                  {typeof window !== "undefined" ? `${window.location.origin}/compare?id=${board.id}` : ""}
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[14.5px] font-bold text-white disabled:opacity-40"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                고객 전용 링크 발행하기
              </button>
            )}
          </div>

          <button type="button" onClick={resetForm} className="mx-auto block text-[14px] text-slate-500 underline underline-offset-4">
            새 비교판 만들기
          </button>
        </section>
      )}
    </main>
  );
}

function AreaCard({
  area,
  onLabelChange,
  onBeforeFile,
  onAddOption,
  onRemoveOption,
  onOptionChange,
  onOptionFile,
  onRemoveArea,
}: {
  area: AreaDraft;
  onLabelChange: (label: string) => void;
  onBeforeFile: (file: File | null) => void;
  onAddOption: () => void;
  onRemoveOption: (optIndex: number) => void;
  onOptionChange: (optIndex: number, patch: Partial<OptionDraft>) => void;
  onOptionFile: (optIndex: number, file: File | null) => void;
  onRemoveArea?: () => void;
}) {
  const beforeInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={area.label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="부위 이름 (예: 주방 싱크대)"
          className="h-11 flex-1 rounded-xl border border-slate-200 px-3.5 text-[14.5px] outline-none focus:border-indigo-500"
        />
        {onRemoveArea && (
          <button type="button" onClick={onRemoveArea} aria-label="부위 삭제" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 자유 입력 칸이라 원래도 어떤 품목이든 적을 수 있지만, 타이핑 없이 바로
          고를 수 있게 우리가 실제로 시공하는 품목 전체를 칩으로 둔다. */}
      <div className="flex flex-wrap gap-1.5">
        {COMMON_AREA_LABELS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => onLabelChange(label)}
            className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition ${
              area.label === label ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        ref={beforeInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onBeforeFile(e.target.files?.[0] ?? null)}
      />
      {area.beforePreviewUrl ? (
        <button type="button" onClick={() => beforeInputRef.current?.click()} className="block w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 blob URL */}
          <img src={area.beforePreviewUrl} alt="시공전 사진" className="aspect-[4/3] w-full rounded-xl object-cover" />
          <span className="mt-1 block text-center text-[12px] text-slate-400">시공전 사진 — 눌러서 바꾸기</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => beforeInputRef.current?.click()}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-400"
        >
          <ImagePlus className="h-6 w-6" />
          <span className="text-[13px] font-semibold">시공전 사진 선택</span>
        </button>
      )}

      <div className="space-y-2.5 pt-1">
        {area.options.map((opt, i) => (
          <OptionRow
            key={i}
            index={i}
            option={opt}
            onChange={(patch) => onOptionChange(i, patch)}
            onFile={(f) => onOptionFile(i, f)}
            onRemove={area.options.length > 1 ? () => onRemoveOption(i) : undefined}
          />
        ))}
        <button
          type="button"
          onClick={onAddOption}
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-50 text-[13px] font-semibold text-slate-500"
        >
          <Plus className="h-3.5 w-3.5" /> 옵션 추가 (예: 투톤)
        </button>
      </div>
    </div>
  );
}

function OptionRow({
  index,
  option,
  onChange,
  onFile,
  onRemove,
}: {
  index: number;
  option: OptionDraft;
  onChange: (patch: Partial<OptionDraft>) => void;
  onFile: (file: File | null) => void;
  onRemove?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl bg-slate-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[12px] font-bold text-slate-400">옵션 {index + 1}</span>
        <input
          type="text"
          value={option.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="옵션 이름 (예: 올화이트)"
          className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-[13.5px] outline-none focus:border-indigo-500"
        />
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label="옵션 삭제" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="text-[11px] font-semibold text-indigo-500">
        👉 여기에 제미나이 등 AI로 만든 시공후 사진을 넣으세요
      </p>
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {option.previewUrl ? (
          <button type="button" onClick={() => fileInputRef.current?.click()} className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 blob URL */}
            <img src={option.previewUrl} alt="시공후 사진" className="h-16 w-16 rounded-lg object-cover" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/50 text-indigo-400"
          >
            <ImagePlus className="h-4 w-4" />
            <span className="text-[9px] font-bold leading-none">AI 사진</span>
          </button>
        )}
        <div className="flex-1 space-y-1.5">
          <input
            type="text"
            value={option.caption}
            onChange={(e) => onChange({ caption: e.target.value })}
            placeholder="캡션 (선택, 예: 상·하부장 화이트)"
            className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-[12.5px] outline-none focus:border-indigo-500"
          />
          <input
            type="text"
            value={option.priceNote}
            onChange={(e) => onChange({ priceNote: e.target.value })}
            placeholder="이 옵션 가격 (선택)"
            className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-[12.5px] outline-none focus:border-indigo-500"
          />
          <input
            type="text"
            value={option.filmName}
            onChange={(e) => onChange({ filmName: e.target.value })}
            placeholder="필름 이름/품번 (선택, 예: 매트 화이트)"
            list="film-name-options"
            className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-[12.5px] outline-none focus:border-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}
