/** 파일을 기기의 공유 시트로 바로 내보낸다(안 되면 갤러리 저장으로 대신한다).
 *
 *  navigator.share({ files })를 쓰면 안드로이드가 당근·숨고·카카오톡 등 설치된
 *  채팅 앱 목록을 바로 보여주므로, 갤러리 저장 → 채팅 앱에서 사진 첨부를 거치는
 *  것보다 "고객에게 보내기" 목적에 훨씬 가깝다(이미 lib/naverBlogExport.ts의
 *  saveAllPhotos, components/PremiumReceipt.tsx가 같은 패턴을 쓰고 있다).
 *
 *  [왜 갤러리 저장이 대안인가 — 2026-11-26 "저장은 되는데 카톡·문자로 못 보낸다"]
 *  navigator.share를 못 쓰는 기기에서 예전에는 <a download>로 내려받게 했는데,
 *  안드로이드 앱(WebView)에서 이 방식은 "다운로드" 폴더에만 남고 카톡·문자의
 *  사진/동영상 첨부 목록이 보는 갤러리(MediaStore)에는 뜨지 않아 "저장은 됐는데
 *  어디 있는지 모르겠다"는 문제가 났다. PremiumReceipt.tsx의 견적서 이미지
 *  저장과 같은 네이티브 플러그인(GallerySaver)으로 MediaStore에 직접 등록해
 *  갤러리·첨부 목록에 바로 보이게 한다. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function shareOrDownloadFile(
  file: File,
  options: { title?: string; text?: string } = {}
): Promise<"shared" | "saved" | "downloaded"> {
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: options.title, text: options.text });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
      // 공유 실패 시 아래 갤러리 저장(또는 다운로드)으로 넘어간다.
    }
  }

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { default: GallerySaver } = await import("@/lib/gallerySaver");
      const dataUrl = await blobToDataUrl(file);
      await GallerySaver.saveImage({ data: dataUrl, fileName: file.name, mimeType: file.type });
      return "saved";
    }
  } catch {
    // 네이티브 저장이 실패하면 아래 일반 웹 다운로드로 폴백한다.
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
