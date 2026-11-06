"use client";

import { useEffect } from "react";

/** app/error.tsx는 layout.tsx 안쪽(ServiceWorkerCleanup 등)에서 난 예외만 잡는다.
 *  layout.tsx 자체가 터지면 Next.js는 이 파일을 쓴다 — 그래서 <html>/<body>를
 *  직접 그려야 한다(평소 layout.tsx가 하던 일을 이 화면이 대신 떠안는다). 거의
 *  일어나지 않지만, 일어났을 때 하얗게 멈추지 않고 최소한 새로고침 버튼은
 *  있게 해 둔다. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <div
          style={{
            display: "flex",
            height: "100dvh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            textAlign: "center",
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "#f8fafc",
            color: "#0f172a",
          }}
        >
          <p style={{ fontSize: 17, fontWeight: 700 }}>앱을 다시 불러오는 중 문제가 생겼어요</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: 999,
              background: "#4f46e5",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              padding: "12px 24px",
              border: "none",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
