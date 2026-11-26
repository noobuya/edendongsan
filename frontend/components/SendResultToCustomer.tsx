"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { fetchAssetBlob, fetchJobCompareBlob } from "@/lib/api";
import { shareOrDownloadFile } from "@/lib/shareMedia";

type SendKey = "image" | "gif" | "mp4";

/** "AI 시공결과" 사진과, 원본이 있으면 시공 전후 "밀어 보기" 움짤(GIF)·영상(MP4)을
 *  고객 채팅으로 바로 보내는 버튼. [최종 뷰어]의 "시공 전후 비교"(화면 안에서
 *  직접 끄는 슬라이더)와 다르게, 여기서 만드는 파일은 당근·숨고·카카오톡 등에
 *  그대로 첨부해 보낼 수 있는 실제 파일이다. */
export default function SendResultToCustomer({
  jobId,
  resultUrl,
  beforeUrl,
}: {
  jobId: string;
  resultUrl: string;
  beforeUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<SendKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(key: SendKey, load: () => Promise<Blob>, fileName: string, mime: string, title: string) {
    setBusyKey(key);
    setNotice(null);
    try {
      const blob = await load();
      const file = new File([blob], fileName, { type: mime });
      const result = await shareOrDownloadFile(file, {
        title,
        text: "고객님, 요청하신 시공 사진입니다.",
      });
      setNotice(
        result === "shared"
          ? null
          : result === "saved"
          ? "갤러리에 저장했어요. 채팅창의 사진/동영상 첨부 아이콘에서 찾아 보내주세요."
          : "다운로드 폴더에 저장했어요. 못 찾으시면 파일 관리 앱의 '다운로드'를 확인해주세요."
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "전송에 실패했습니다.");
    } finally {
      setBusyKey(null);
    }
  }

  const items: { key: SendKey; label: string; onClick: () => void }[] = [
    {
      key: "image",
      label: "🖼 AI 시공결과 사진 보내기",
      onClick: () => send("image", () => fetchAssetBlob(resultUrl), "AI시공결과.jpg", "image/jpeg", "AI 시공결과"),
    },
  ];
  if (beforeUrl) {
    items.push(
      {
        key: "gif",
        label: "🎞 시공 전후 움짤(GIF) 보내기",
        onClick: () =>
          send("gif", () => fetchJobCompareBlob(jobId, "gif"), "시공전후.gif", "image/gif", "시공 전후 비교"),
      },
      {
        key: "mp4",
        label: "🎬 시공 전후 영상(MP4) 보내기",
        onClick: () =>
          send("mp4", () => fetchJobCompareBlob(jobId, "mp4"), "시공전후.mp4", "video/mp4", "시공 전후 비교"),
      }
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white"
      >
        <Send className="h-3.5 w-3.5" />
        고객에게 보내기
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={busyKey !== null}
                onClick={item.onClick}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {busyKey === item.key ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
                {item.label}
              </button>
            ))}
            {notice && <p className="px-2.5 pt-1 text-[11px] leading-relaxed text-slate-500">{notice}</p>}
          </div>
        </>
      )}
    </div>
  );
}
