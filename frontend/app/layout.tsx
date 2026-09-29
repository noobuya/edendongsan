import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerCleanup from "@/components/ServiceWorkerCleanup";

export const metadata: Metadata = {
  title: "인테리어 Pro 플래너",
  description: "인테리어 필름/조명/실링팬/싱크볼 시공 AI 견적 & 시뮬레이션",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "인테리어 Pro",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
