import withPWAInit from "@ducanh2912/next-pwa";

// Capacitor(APK)용으로 빌드할 때만 켠다: `npm run build:capacitor`가 이 값을 설정한다.
// 일반 웹 배포(`npm run build`)는 지금까지처럼 평범한 Next 서버 빌드로 동작한다.
const isCapacitorBuild = process.env.CAPACITOR_BUILD === "1";

// 빌드 결과물은 개발 서버(`npm run dev`)가 쓰는 .next와 절대 같은 폴더를 쓰지 않는다.
// 공유하면 빌드를 돌리는 순간 켜져 있던 개발 서버가 자기 청크 파일을 잃고,
// 페이지는 200인데 CSS/JS만 404가 되어 "칸에 글자만 보이는" 화면이 된다.
//
// 판별은 실행한 명령으로 한다. 예전에 NODE_ENV === "production"으로 판별했더니
// 설정 파일이 읽히는 시점에 그 값이 아직 세팅되지 않은 경우가 있어서, 빌드가
// 그대로 .next에 쓰이며 켜져 있던 개발 서버를 두 번이나 깨뜨렸다.
const isDevServer = process.argv.includes("dev") || process.env.npm_lifecycle_event === "dev";
const distDir = isDevServer ? ".next" : isCapacitorBuild ? ".next-capacitor" : ".next-build";

const withPWA = withPWAInit({
  dest: "public",
  // Capacitor WebView 안에서는 서비스워커가 API 서버 주소(ngrok 등)가 바뀔 때마다
  // 오래된 캐시를 붙들고 있을 위험이 크고, 애초에 네이티브 앱 셸이라 PWA 오프라인
  // 캐싱이 필요 없다 — Capacitor 빌드에서는 꺼둔다.
  disable: process.env.NODE_ENV === "development" || isCapacitorBuild,
  register: true,
  workboxOptions: {
    disableDevLogs: true,
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 브라우저로 열었을 때 /api·/static·/estimator/api 호출을 같은 주소에서 받아 백엔드(8000)로 넘긴다
  // (lib/api.ts의 computeApiBase 참고). 정적 export(APK) 빌드는 서버가 없어 rewrites를 쓸 수 없다.
  ...(isCapacitorBuild
    ? {}
    : {
        experimental: {
          // AI 블로그 글 생성처럼 오래 걸리는 요청이 기본 30초 제한에 잘리지 않게 한다.
          proxyTimeout: 180_000,
        },
        async rewrites() {
          const backend = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";
          return [
            { source: "/api/:path*", destination: `${backend}/api/:path*` },
            { source: "/static/:path*", destination: `${backend}/static/:path*` },
            { source: "/estimator/api/:path*", destination: `${backend}/estimator/api/:path*` },
          ];
        },
      }),
  // 개발은 .next, 빌드는 별도 폴더 (위 isDevServer 주석 참고).
  distDir,
  ...(isCapacitorBuild
    ? {
        // Capacitor는 정적 HTML/JS/CSS 파일 묶음을 앱 안에 넣고 로컬에서 서빙한다
        // (백엔드 API 호출만 원격으로 나간다) — 그러려면 Next 서버 없이도 돌아가는
        // 정적 export가 필요하다. app/blog/post 처럼 쿼리스트링으로 값을 받는
        // 페이지만 쓰고 동적 경로 세그먼트([id] 같은)는 두지 않는 게 이 모드의 전제다.
        output: "export",
        // 주의: output:"export"에서는 내보내기 결과물이 distDir(.next-capacitor)에
        // 생긴다("out"이 아니다). capacitor.config.ts의 webDir을 같은 값으로 맞출 것.
        //
        // next/image의 이미지 최적화는 서버가 있어야 동작하는데 정적 export엔
        // 서버가 없다 — 켜져 있으면 export가 아예 안 되니 반드시 꺼야 한다.
        images: { unoptimized: true },
        // file://(구버전 WebView) 또는 capacitor://localhost 스킴에서 "/blog"가
        // "/blog/index.html"로 제대로 풀리려면 끝에 슬래시가 붙어야 한다.
        trailingSlash: true,
      }
    : {}),
};

export default withPWA(nextConfig);
