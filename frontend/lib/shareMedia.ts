/** 파일을 기기의 공유 시트로 바로 내보낸다(안 되면 다운로드로 대신한다).
 *
 *  navigator.share({ files })를 쓰면 안드로이드가 당근·숨고·카카오톡 등 설치된
 *  채팅 앱 목록을 바로 보여주므로, 갤러리 저장 → 채팅 앱에서 사진 첨부를 거치는
 *  것보다 "고객에게 보내기" 목적에 훨씬 가깝다(이미 lib/naverBlogExport.ts의
 *  saveAllPhotos, components/PremiumReceipt.tsx가 같은 패턴을 쓰고 있다).
 *  지원하지 않거나 실패하면 <a download>로 내려받게 하고, 그 사실을 호출한
 *  쪽에 알려 안내 문구를 보여줄 수 있게 한다. */
export async function shareOrDownloadFile(
  file: File,
  options: { title?: string; text?: string } = {}
): Promise<"shared" | "downloaded"> {
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: options.title, text: options.text });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
      // 공유 실패 시 아래 다운로드로 넘어간다.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}
