/** 사진/영상을 안드로이드 갤러리(사진·동영상 앱)에 저장한다.
 *
 *  [왜 필요한가]
 *  웹의 <a download> 방식은 이 앱의 안드로이드 WebView에서는 조용히 실패하거나,
 *  실패하지 않더라도 "다운로드" 폴더에만 남고 사진/동영상 앱(갤러리)에는 뜨지
 *  않는다. MediaStore(Images 또는 Video)에 직접 등록해야 갤러리에 보이고
 *  카톡·문자 앱의 첨부 목록에도 나타나므로, 네이티브 플러그인
 *  (android/.../GallerySaverPlugin.java)을 거쳐야 한다. */

import { registerPlugin } from "@capacitor/core";

interface GallerySaverPlugin {
  /** mimeType을 생략하면 "image/png"로 저장된다. "video/..."로 시작하면
   *  네이티브 쪽에서 사진이 아니라 동영상 컬렉션(MediaStore.Video)에 등록한다 —
   *  영상을 사진 컬렉션에 넣으면 카톡·문자의 "동영상" 첨부 목록에서 찾지 못한다. */
  saveImage(options: { data: string; fileName: string; mimeType?: string }): Promise<{ uri: string }>;
}

const GallerySaver = registerPlugin<GallerySaverPlugin>("GallerySaver");

export default GallerySaver;
