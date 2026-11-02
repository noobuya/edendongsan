"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Film, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import BusinessBanner from "@/components/BusinessBanner";
import { composeBlog } from "@/lib/api";
import { readOwnerToken } from "@/lib/ownerToken";
import { useAndroidBack } from "@/lib/useAndroidBack";

/** 견적 없이 "가진 사진 + 영상 + 제목"만으로 블로그 글을 만드는 화면(사장님 전용).
 *
 *  [2026-11-03 사장님 요청] 앱 밖에서 찍어 둔 시공 사진·영상으로도 네이버용 글을 바로
 *  만들 수 있게 한다. 사진을 시공 전 / 작업 중 / 시공 후로 나눠 넣으면 같은 순번끼리
 *  (시공 전 1 ↔ 시공 후 1) 비교 사진이 되고, AI가 사진을 보고 본문을 새로 쓴다(제목은
 *  사장님이 정한 그대로). 영상을 넣으면 웹용으로 바꿔 붙이고, 없으면 사진으로 자동 생성.
 *  다 되면 블로그 글 화면으로 넘어가 거기서 네이버로 옮긴다. */

type Stage = "before" | "progress" | "after";

const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: "before", label: "시공 전", hint: "바꾸기 전 모습" },
  { id: "after", label: "시공 후 (결과물)", hint: "같은 순서·같은 각도로 넣으면 비교 사진이 돼요" },
  { id: "progress", label: "작업 중 (선택)", hint: "작업 과정 사진" },
];

// 서버 앞단(Caddy) 요청 한도가 60MB라, 사진은 올리기 전에 줄이고 영상은 크기를 미리 본다.
const MAX_VIDEO_MB = 50;
const PHOTO_MAX_SIDE = 2560;

interface Picked {
  key: string;
  file: File;
  preview: string;
}

/** 사진을 긴 변 2560px JPEG로 줄인다 — 휴대폰 원본(장당 3~6MB)을 그대로 올리면 금방
 *  요청 한도를 넘는다. EXIF 방향은 createImageBitmap이 반영한다. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file; // 줄이기에 실패하면(HEIC 등) 원본을 보내고 서버가 처리한다.
  }
}

export default function BlogComposePage() {
  const router = useRouter();
  useAndroidBack(() => {
    router.back();
    return true;
  });

  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [siteName, setSiteName] = useState("");
  const [stamp, setStamp] = useState(true);
  const [photos, setPhotos] = useState<Record<Stage, Picked[]>>({ before: [], progress: [], after: [] });
  const [video, setVideo] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const keySeq = useRef(0);

  useEffect(() => {
    setOwnerToken(readOwnerToken());
    setChecked(true);
  }, []);

  // 미리보기 URL은 화면을 떠날 때 정리한다.
  const allPreviews = useRef<string[]>([]);
  useEffect(() => () => allPreviews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function addPhotos(stage: Stage, files: FileList | null) {
    if (!files) return;
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name))
      .map((file) => {
        const preview = URL.createObjectURL(file);
        allPreviews.current.push(preview);
        return { key: `p${keySeq.current++}`, file, preview };
      });
    setPhotos((prev) => ({ ...prev, [stage]: [...prev[stage], ...picked] }));
  }

  function removePhoto(stage: Stage, key: string) {
    setPhotos((prev) => ({ ...prev, [stage]: prev[stage].filter((p) => p.key !== key) }));
  }

  function pickVideo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      setError(`영상이 너무 커요(${Math.round(file.size / 1024 / 1024)}MB). ${MAX_VIDEO_MB}MB 이하로 짧게 잘라서 넣어 주세요.`);
      return;
    }
    setError(null);
    setVideo(file);
  }

  const photoCount = photos.before.length + photos.progress.length + photos.after.length;
  const pairCount = Math.min(photos.before.length, photos.after.length);
  const canSubmit = !!ownerToken && title.trim().length > 0 && photoCount > 0 && !submitting;

  async function handleSubmit() {
    if (!ownerToken || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const shrink = (list: Picked[]) => Promise.all(list.map((p) => shrinkPhoto(p.file)));
      const [before, progress, after] = await Promise.all([
        shrink(photos.before),
        shrink(photos.progress),
        shrink(photos.after),
      ]);
      const { job_id, warning } = await composeBlog(
        { title: title.trim(), memo, siteName, stamp, makeVideo: true, before, progress, after, video },
        ownerToken
      );
      if (warning) window.alert(warning);
      router.push(`/blog/post?job=${job_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "블로그를 만들지 못했습니다.");
      setSubmitting(false);
    }
  }

  if (checked && !ownerToken) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-4 py-16 xs:px-6">
        <Link href="/blog" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500">
          <ArrowLeft className="h-4 w-4" />
          블로그 목록
        </Link>
        <p className="rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-600">
          블로그 만들기는 사장님 기기에서만 쓸 수 있어요. 첫 화면의 <b>사장님 기기 설정</b>에서 관리자 토큰을 넣은
          뒤 다시 들어와 주세요.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-32 pt-10 xs:px-6">
      <div className="mb-6">
        <BusinessBanner />
      </div>
      <Link href="/blog" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" />
        블로그 목록
      </Link>

      <header className="mb-8 space-y-2">
        <h1 className="text-[26px] font-black tracking-tight text-slate-900">사진으로 블로그 만들기</h1>
        <p className="text-sm leading-relaxed text-slate-500">
          제목과 사진만 넣으면 AI가 사진을 보고 글을 새로 쓰고, 시공 영상까지 붙여 드려요. 완성되면 바로 네이버
          블로그로 옮길 수 있어요.
        </p>
      </header>

      <div className="space-y-8">
        {/* 1. 제목 */}
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[15px] font-bold text-slate-900">
            <span className="mr-2 text-emerald-600">1</span>제목
          </h2>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="[대구 인테리어 필름] 20년 된 주방, 필름 하나로 새집처럼"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-[15px] outline-none focus:border-emerald-500"
          />
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="시공 내용 한 줄 (선택) — 예: 주방 상하부장 화이트 필름, 손잡이 교체"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-[14px] outline-none focus:border-emerald-500"
          />
          <input
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="현장 이름 (선택) — 예: 수성구 OO아파트"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-[14px] outline-none focus:border-emerald-500"
          />
        </section>

        {/* 2. 사진 */}
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-[15px] font-bold text-slate-900">
              <span className="mr-2 text-emerald-600">2</span>사진
            </h2>
            <p className="text-xs leading-relaxed text-slate-500">
              시공 전 1번 ↔ 시공 후 1번처럼 <b>같은 순번끼리</b> 비교 사진이 돼요. 같은 각도로 찍은 사진을 같은
              순서로 넣어 주세요.
              {pairCount > 0 && <span className="ml-1 font-semibold text-emerald-700">비교 사진 {pairCount}쌍</span>}
            </p>
          </div>
          {STAGES.map((stage) => (
            <div key={stage.id} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-slate-700">{stage.label}</span>
                <span className="text-[11px] text-slate-400">{stage.hint}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {photos[stage.id].map((p, i) => (
                  <div key={p.key} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                    <img src={p.preview} alt={`${stage.label} ${i + 1}`} className="h-full w-full object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePhoto(stage.id, p.key)}
                      aria-label="사진 빼기"
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => inputs.current[stage.id]?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 transition hover:border-emerald-400 hover:text-emerald-600"
                >
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[11px] font-semibold">추가</span>
                </button>
              </div>
              <input
                ref={(el) => {
                  inputs.current[stage.id] = el;
                }}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addPhotos(stage.id, e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          ))}
          <label className="flex items-center gap-2 text-[13px] text-slate-600">
            <input type="checkbox" checked={stamp} onChange={(e) => setStamp(e.target.checked)} className="h-4 w-4" />
            사진 왼쪽 아래에 업체명·시공 전/후·날짜 표시 넣기
          </label>
        </section>

        {/* 3. 영상 */}
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[15px] font-bold text-slate-900">
            <span className="mr-2 text-emerald-600">3</span>영상 (선택)
          </h2>
          {video ? (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700">
              <Film className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 truncate">{video.name}</span>
              <span className="text-xs text-slate-400">{Math.round(video.size / 1024 / 1024)}MB</span>
              <button type="button" onClick={() => setVideo(null)} aria-label="영상 빼기" className="text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputs.current.video?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-4 text-[13px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
            >
              <Film className="h-4 w-4" />
              현장 영상 넣기 ({MAX_VIDEO_MB}MB 이하)
            </button>
          )}
          <p className="text-xs text-slate-400">
            영상을 안 넣으면 사진으로 시공 전 → 후 홍보 영상을 자동으로 만들어 드려요.
          </p>
          <input
            ref={(el) => {
              inputs.current.video = el;
            }}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              pickVideo(e.target.files);
              e.target.value = "";
            }}
          />
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <p className="flex-1 text-xs text-slate-500">
            {submitting
              ? "AI가 사진을 보고 글을 쓰는 중이에요… (1분 안팎)"
              : `사진 ${photoCount}장${video ? " · 영상 1개" : ""}`}
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-full bg-[#03c75a] px-5 py-3 text-[14px] font-bold text-white transition active:scale-95 disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {submitting ? "만드는 중" : "블로그 만들기"}
          </button>
        </div>
      </div>
    </main>
  );
}
