"use client";

import { useEffect } from "react";

/** 남아 있는 PWA 서비스워커를 해제하고 캐시를 비운다.
 *
 *  이 앱은 어디서도 서비스워커를 등록하지 않는다(next.config.mjs에서 PWA를 꺼 뒀다).
 *  그러므로 등록된 서비스워커가 발견된다면 그건 예전 빌드가 남긴 찌꺼기이고, 그게
 *  살아 있으면 새 화면(HTML)에 옛 JS를 물려줘서 "화면은 바뀌었는데 버튼이 아무
 *  반응이 없는" 상태가 된다.
 *
 *  개발 모드에서만 청소하면 APK에 한 번 등록된 서비스워커는 앱을 새로 설치해도
 *  출처(origin)에 남아 계속 말썽을 부리므로, 환경을 가리지 않고 항상 청소한다. */
export default function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    (async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) return;

      await Promise.all(regs.map((r) => r.unregister()));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // 해제 직후의 화면은 여전히 캐시에서 온 것이라, 새 코드로 한 번 다시 받아와야 한다.
      window.location.reload();
    })().catch(() => {
      /* 캐시 접근이 막힌 환경(사생활 보호 모드 등)에서는 조용히 넘어간다 */
    });
  }, []);

  return null;
}
