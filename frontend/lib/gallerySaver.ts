/** 견적서 이미지를 안드로이드 갤러리(사진 앱)에 저장한다.
 *
 *  [왜 필요한가]
 *  웹의 <a download> 방식은 이 앱의 안드로이드 WebView에서는 조용히 실패하거나,
 *  실패하지 않더라도 "다운로드" 폴더에만 남고 사진 앱(갤러리)에는 뜨지 않는다.
 *  MediaStore.Images에 직접 등록해야 갤러리에 보이므로, 네이티브 플러그인
 *  (android/.../GallerySaverPlugin.java)을 거쳐야 한다. */

import { registerPlugin } from "@capacitor/core";

interface GallerySaverPlugin {
  saveImage(options: { data: string; fileName: string }): Promise<{ uri: string }>;
}

const GallerySaver = registerPlugin<GallerySaverPlugin>("GallerySaver");

export default GallerySaver;
