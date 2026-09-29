"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Camera, ExternalLink, ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import CameraSheet from "@/components/CameraSheet";
import { deleteBlogPost, deleteWorkPhoto, generateBlogPost, uploadWorkPhoto } from "@/lib/api";
import type { BlogPost, WorkPhoto, WorkPhotoStage } from "@/types";

const STAGE_META: { id: WorkPhotoStage; label: string }[] = [
  { id: "before", label: "시공 전" },
  { id: "progress", label: "작업 중" },
  { id: "after", label: "시공 후" },
];

interface Props {
  jobId: string;
  initialPhotos: WorkPhoto[];
  initialBlogPost?: BlogPost;
}

export default function SitePhotoGallery({ jobId, initialPhotos, initialBlogPost }: Props) {
  const [photos, setPhotos] = useState<WorkPhoto[]>(initialPhotos);
  const [blogPost, setBlogPost] = useState<BlogPost | undefined>(initialBlogPost);
  const [uploadingStage, setUploadingStage] = useState<WorkPhotoStage | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Record<WorkPhotoStage, string>>({
    before: "",
    progress: "",
    after: "",
  });
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 앱 내장 카메라로 찍을 단계(시공 전/작업 중/시공 후). null이면 카메라가 닫힌 상태.
  const [cameraStage, setCameraStage] = useState<WorkPhotoStage | null>(null);

  const beforeInputRef = useRef<HTMLInputElement>(null);
  const progressInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);
  const inputRefs: Record<WorkPhotoStage, React.RefObject<HTMLInputElement>> = {
    before: beforeInputRef,
    progress: progressInputRef,
    after: afterInputRef,
  };

  function handleFile(stage: WorkPhotoStage, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadPhoto(stage, file);
  }

  async function uploadPhoto(stage: WorkPhotoStage, file: File) {
    setError(null);
    setUploadingStage(stage);
    try {
      const photo = await uploadWorkPhoto(jobId, file, stage, captions[stage].trim());
      setPhotos((prev) => [...prev, photo]);
      setCaptions((prev) => ({ ...prev, [stage]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진 업로드에 실패했습니다.");
    } finally {
      setUploadingStage(null);
    }
  }

  async function handleDelete(photoId: string) {
    // 서버 응답을 기다리지 않고 먼저 목록에서 지운다 — 삭제가 실패해도(네트워크
    // 순간 오류 등) 사용자 입장에서 크게 문제되지 않고, 다음 조회 시 서버 상태로
    // 다시 맞춰진다.
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    try {
      await deleteWorkPhoto(jobId, photoId);
    } catch {
      // 무시 — 위 주석 참고
    }
  }

  async function handleGenerateBlog() {
    setError(null);
    setGenerating(true);
    try {
      const post = await generateBlogPost(jobId);
      setBlogPost(post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "블로그 글 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteBlog() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await deleteBlogPost(jobId);
      setBlogPost(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "블로그 글 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="space-y-5 glass-panel p-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">작업사진 촬영</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          현장을 방문할 때마다 시공 전/작업 중/시공 후 사진을 찍어 올려두면, 아래에서 AI가 그 사진으로
          블로그 후기 글을 자동으로 써드립니다
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {STAGE_META.map((stage) => {
          const stagePhotos = photos.filter((p) => p.stage === stage.id);
          const isUploading = uploadingStage === stage.id;
          return (
            <div key={stage.id} className="space-y-1.5">
              <p className="text-xs font-medium text-slate-500">{stage.label}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {stagePhotos.map((photo) => (
                  <div
                    key={photo.id}
                    className="group relative aspect-square overflow-hidden rounded-md bg-slate-100"
                  >
                    <AssetImage
                      src={photo.url}
                      alt={stage.label}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleDelete(photo.id)}
                      className="absolute right-0.5 top-0.5 hidden rounded bg-black/60 p-0.5 text-white group-hover:block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {/* 촬영(카메라)·앨범 두 버튼을 나란히 둔다 — 현장에 따라 그 자리에서
                    찍거나, 미리 찍어둔 사진을 바로 골라 쓸 수 있다. 같은 크기·모양의
                    유리 타일이라 둘 중 무엇을 눌러도 같은 무게로 느껴진다. */}
                <button
                  type="button"
                  onClick={() => setCameraStage(stage.id)}
                  disabled={isUploading}
                  aria-label={`${stage.label} 사진 촬영`}
                  className="group flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-slate-200/70 bg-white/60 text-slate-400 backdrop-blur-md transition-all duration-200 hover:border-indigo-300 hover:bg-indigo-50/70 hover:text-indigo-500 active:scale-95 disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Camera className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
                      <span className="text-[10px]">촬영</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => inputRefs[stage.id].current?.click()}
                  disabled={isUploading}
                  aria-label={`${stage.label} 앨범에서 선택`}
                  className="group flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-slate-200/70 bg-white/60 text-slate-400 backdrop-blur-md transition-all duration-200 hover:border-indigo-300 hover:bg-indigo-50/70 hover:text-indigo-500 active:scale-95 disabled:opacity-50"
                >
                  <ImagePlus className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
                  <span className="text-[10px]">앨범</span>
                </button>
              </div>
              <input
                type="text"
                value={captions[stage.id]}
                onChange={(e) => setCaptions((prev) => ({ ...prev, [stage.id]: e.target.value }))}
                placeholder="메모(선택)"
                className="w-full min-w-0 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 outline-none placeholder:text-slate-300 focus:border-blue-400"
              />
              {/* capture 속성은 쓰지 않는다 — 기본 카메라 앱이 열리면 촬영본이 폰
                  갤러리에 그대로 쌓인다. 이 입력은 앨범에서 고를 때만 쓴다. */}
              <input
                ref={inputRefs[stage.id]}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(stage.id, e)}
              />
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 pt-3">
        {blogPost ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">{blogPost.title}</p>
              <div className="flex shrink-0 items-center gap-2.5">
                <Link
                  href={`/blog/post?job=${jobId}`}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  블로그에서 보기 <ExternalLink className="h-3 w-3" />
                </Link>
                <button
                  type="button"
                  onClick={handleDeleteBlog}
                  onBlur={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className={`flex items-center gap-1 text-xs font-medium disabled:opacity-50 ${
                    confirmingDelete ? "text-red-600" : "text-slate-400 hover:text-red-500"
                  }`}
                >
                  {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {deleting ? "삭제 중..." : confirmingDelete ? "한 번 더 누르면 삭제" : "삭제"}
                </button>
              </div>
            </div>
            <p className="line-clamp-3 whitespace-pre-line text-xs text-slate-500">{blogPost.content}</p>

            <button
              type="button"
              onClick={handleGenerateBlog}
              disabled={generating}
              className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-50"
            >
              {generating ? "다시 생성하는 중..." : "다시 생성하기"}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleGenerateBlog}
              disabled={generating || photos.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "AI가 블로그 글을 쓰는 중..." : "AI로 블로그 글 쓰기"}
            </button>
            {photos.length === 0 && (
              <p className="mt-1.5 text-center text-[11px] text-slate-300">
                현장 사진을 먼저 올리면 생성할 수 있습니다
              </p>
            )}
          </>
        )}
      </div>

      <CameraSheet
        open={cameraStage !== null}
        onCapture={(file) => {
          if (cameraStage) void uploadPhoto(cameraStage, file);
        }}
        onClose={() => setCameraStage(null)}
        onPickFile={() => cameraStage && inputRefs[cameraStage].current?.click()}
      />
    </div>
  );
}
