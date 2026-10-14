import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerCleanup from "@/components/ServiceWorkerCleanup";

export const metadata: Metadata = {
  title: "대한인테리어필름 플래너",
  description: "인테리어 필름/조명/실링팬/싱크볼 시공 AI 견적 & 시뮬레이션",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "대한인테리어필름",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale을 1로 막아뒀던 적이 있다 — 버튼을 더블탭할 때 실수로 확대되는
  // 걸 막으려는 의도였는데, 그 대가로 "시공 결과" 사진처럼 직접 핀치줌 기능이
  // 없는 화면에서는 사진을 확대해 디테일을 보려는 손짓 자체가 막히고, 핀치를
  // 시작했다가 그대로 1배로 되튕기는 "확대하면 다시 작아지는" 현상으로 보였다.
  // 편집 화면(ManualMaskStage 등)은 자체 핀치줌 라이브러리를 쓰고 캔버스에
  // touch-action: none을 걸어 두어, 이 값을 풀어도 두 확대 기능이 겹치지 않는다.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      {/* 연한 회색 바탕 위에 흰 카드를 얹어 깊이를 만드는 것이 이 앱 화면의 기본 규칙이다. */}
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        <ServiceWorkerCleanup />
        {children}
      </body>
    </html>
  );
}
