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
 *  출처(origin)에 남아 계속 말썽을 부리므로, 환경을 가리지 않고 항상 청소한다.
 *
 *  [한 세션에 한 번만 리로드한다 — "화면이 깜빡이고 처음으로 돌아간다" 사고]
 *  한동안 next.config.mjs가 일반 웹 빌드에서는 next-pwa를 끄지 않고 있었다
 *  (register:true로 실제로 서비스워커를 등록했다). 그 설정이 살아 있는 동안은
 *  여기서 지우자마자 next-pwa가 다시 등록하고, 다음 리로드에서 또 발견해 또
 *  지우고 또 리로드하는 무한 루프였다 — 매 리로드가 화면 깜빡임으로, 리액트
 *  상태가 통째로 날아가는 것이 "1단계로 돌아간다"로 보였다. 지금은 그 설정도
 *  고쳤지만(next.config.mjs), 이 컴포넌트 혼자서도 같은 사고가 재발하지
 *  않도록 "이 세션에서 이미 한 번 리로드했다"는 표시를 남겨 두 번째부터는
 *  해제만 하고 리로드는 건너뛴다 — 어떤 경로로 서비스워커가 다시 등록되든
 *  무한 루프 자체가 원천적으로 불가능해진다. */
const RELOAD_GUARD_KEY = "eden_sw_cleanup_reloaded";

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

      let alreadyReloaded = false;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY) === "1";
      } catch {
        // sessionStorage를 못 읽는 환경 — 안전하게 "아직 안 했다"고 본다.
      }
      if (alreadyReloaded) return; // 이번 세션엔 이미 한 번 했다 — 더 돌지 않는다.

      try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
      } catch {
        /* 못 저장해도 아래 reload는 그대로 진행 — 최악의 경우 다음 로드에서
           한 번 더 돌 뿐, sessionStorage 자체가 막힌 극히 드문 환경이다. */
      }
      // 해제 직후의 화면은 여전히 캐시에서 온 것이라, 새 코드로 한 번 다시 받아와야 한다.
      window.location.reload();
    })().catch(() => {
      /* 캐시 접근이 막힌 환경(사생활 보호 모드 등)에서는 조용히 넘어간다 */
    });
  }, []);

  return null;
}
