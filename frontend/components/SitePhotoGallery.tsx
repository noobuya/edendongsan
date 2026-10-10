"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Camera, ExternalLink, ImagePlus, Loader2, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import AssetImage from "@/components/AssetImage";
import CameraSheet from "@/components/CameraSheet";
import CopyToNaverButton from "@/components/blog/CopyToNaverButton";
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
  /** 사장님 기기의 관리자 토큰. 없으면(학생 기기) 사진 추가·삭제·블로그 글 작성은
   *  서버가 거절하므로, 그 버튼들을 아예 숨기고 읽기 전용으로 보여준다. */
  ownerToken: string | null;
  /** 디지털 보증서(/warranty) 링크는 포트폴리오 갤러리와 같은 기준(완료+서명)일
   *  때만 보여준다 — 그 전엔 백엔드가 어차피 404를 돌려주므로 미리 숨겨 둔다. */
  isDone: boolean;
  hasSignature: boolean;
}

export default function SitePhotoGallery({
  jobId,
  initialPhotos,
  initialBlogPost,
  ownerToken,
  isDone,
  hasSignature,
}: Props) {
  const isOwner = !!ownerToken;
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
    if (!ownerToken) return;
    setError(null);
    setUploadingStage(stage);
    try {
      const photo = await uploadWorkPhoto(jobId, file, stage, captions[stage].trim(), ownerToken);
      setPhotos((prev) => [...prev, photo]);
      setCaptions((prev) => ({ ...prev, [stage]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진 업로드에 실패했습니다.");
    } finally {
      setUploadingStage(null);
    }
  }

  async function handleDelete(photoId: string) {
    if (!ownerToken) return;
    // 서버 응답을 기다리지 않고 먼저 목록에서 지운다 — 삭제가 실패해도(네트워크
    // 순간 오류 등) 사용자 입장에서 크게 문제되지 않고, 다음 조회 시 서버 상태로
    // 다시 맞춰진다.
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    try {
      await deleteWorkPhoto(jobId, photoId, ownerToken);
    } catch {
      // 무시 — 위 주석 참고
    }
  }

  async function handleGenerateBlog() {
    if (!ownerToken) return;
    setError(null);
    setGenerating(true);
    try {
      const post = await generateBlogPost(jobId, ownerToken);
      setBlogPost(post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "블로그 글 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteBlog() {
    if (!ownerToken) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await deleteBlogPost(jobId, ownerToken);
      setBlogPost(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "블로그 글 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  // 학생 기기에는 올려둔 사진·블로그 글이 하나도 없으면 아예 보여줄 게 없다 —
  // 추가·삭제는 사장님 기기 전용이라 빈 갤러리만 뜨는 건 혼란스럽다.
  if (!isOwner && photos.length === 0 && !blogPost) return null;

  return (
    <div className="space-y-5 glass-panel p-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">작업사진 촬영</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          {isOwner
            ? "현장을 방문할 때마다 시공 전/작업 중/시공 후 사진을 찍어 올려두면, 아래에서 AI가 그 사진으로 블로그 후기 글을 자동으로 써드립니다"
            : "사진 추가·삭제와 블로그 글 작성은 사장님 기기에서만 할 수 있어요"}
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
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => handleDelete(photo.id)}
                        className="absolute right-0.5 top-0.5 hidden rounded bg-black/60 p-0.5 text-white group-hover:block"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                {/* 촬영(카메라)·앨범 두 버튼을 나란히 둔다 — 현장에 따라 그 자리에서
                    찍거나, 미리 찍어둔 사진을 바로 골라 쓸 수 있다. 같은 크기·모양의
                    유리 타일이라 둘 중 무엇을 눌러도 같은 무게로 느껴진다. */}
                {isOwner && (
                  <>
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
                  </>
                )}
              </div>
              {isOwner && (
                <input
                  type="text"
                  value={captions[stage.id]}
                  onChange={(e) => setCaptions((prev) => ({ ...prev, [stage.id]: e.target.value }))}
                  placeholder="메모(선택)"
                  className="w-full min-w-0 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 outline-none placeholder:text-slate-300 focus:border-blue-400"
                />
              )}
              {/* capture 속성은 쓰지 않는다 — 기본 카메라 앱이 열리면 촬영본이 폰
                  갤러리에 그대로 쌓인다. 이 입력은 앨범에서 고를 때만 쓴다. */}
              {isOwner && (
                <input
                  ref={inputRefs[stage.id]}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFile(stage.id, e)}
                />
              )}
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
                {isOwner && (
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
                )}
              </div>
            </div>
            <p className="line-clamp-3 whitespace-pre-line text-xs text-slate-500">{blogPost.content}</p>

            {isOwner && <CopyToNaverButton post={blogPost} />}

            {isOwner && (
              <button
                type="button"
                onClick={handleGenerateBlog}
                disabled={generating}
                className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                {generating ? "다시 생성하는 중..." : "다시 생성하기"}
              </button>
            )}
          </div>
        ) : (
          isOwner && (
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
          )
        )}
      </div>

      {/* 블로그(SEO 공개 목록)와는 별개 — 고객 1명에게 바로 보내는 비공개 공유 링크를
          만드는 경로다. 사진이 하나도 없어도(아직 블로그 글 안 쓴 상태여도) 들어갈 수
          있다 — 이 화면에서 새로 사진을 올려도 되기 때문이다. */}
      {isOwner && (
        <div className="border-t border-slate-100 pt-3">
          <Link
            href={`/proposal/new?job=${jobId}`}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 py-2.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
          >
            <Sparkles className="h-4 w-4" />
            AI 제안서 만들기(고객 발송용)
          </Link>
        </div>
      )}

      {/* 시공 완료+서명된 건만 보증서가 실제로 존재한다(warranty.py와 같은 기준) —
          그 전엔 눌러도 404라 아예 숨겨 둔다. */}
      {isOwner && isDone && hasSignature && (
        <div className="border-t border-slate-100 pt-3">
          <Link
            href={`/warranty?job=${jobId}`}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            <ShieldCheck className="h-4 w-4" />
            디지털 보증서 보기(고객 공유용)
          </Link>
        </div>
      )}

      <CameraSheet
        open={isOwner && cameraStage !== null}
        onCapture={(file) => {
          if (cameraStage) void uploadPhoto(cameraStage, file);
        }}
        onClose={() => setCameraStage(null)}
        onPickFile={() => cameraStage && inputRefs[cameraStage].current?.click()}
      />
    </div>
  );
}
