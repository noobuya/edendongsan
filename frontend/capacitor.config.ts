import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.interior.pro",
  appName: "인테리어 Pro",
  // `npm run build:capacitor`가 만드는 정적 내보내기 결과물 경로. 앱은 이 폴더의
  // 파일을 기기 안에서 직접 열고, 백엔드 API만 원격으로 호출한다.
  //
  // next.config.mjs에서 APK 빌드용 distDir을 ".next-capacitor"로 잡았기 때문에
  // 내보내기 결과도 그 폴더에 생긴다. 여기 경로가 어긋나면 예전 빌드 결과가
  // 그대로 APK에 담겨, 폰에서만 낡은 화면이 보이는 문제가 생긴다.
  // (반드시 next.config.mjs의 distDir과 같은 값을 유지할 것.)
  webDir: ".next-capacitor",

  // [폰 앱이 코드 수정을 자동으로 받게 하는 설정]
  // 이 domain(백엔드 ngrok 고정 주소, backend/app/main.py 맨 아래가 그 안에서 프론트를
  // 같은 주소로 되비춰준다)을 앱이 직접 연다. webDir(위 .next-capacitor)에 구워 넣은
  // 정적 파일은 더 이상 쓰이지 않는다 — 그래서 여기 코드를 고쳐 저장하면(프론트는 next dev의
  // Fast Refresh로, 백엔드는 uvicorn --reload로 즉시 반영됨) 앱을 다시 빌드하거나 새로
  // 설치하지 않아도 다음에 열 때 바로 최신 화면이 뜬다.
  //
  // 그 대가로 PC의 백엔드(8000)·프론트(3000)·ngrok이 꺼져 있으면 앱이 통째로 열리지
  // 않는다("프론트 서버에 연결하지 못했습니다"). 오프라인에서도 도는 진짜 배포판이
  // 필요해지면, 이 server 블록을 지우고(webDir을 다시 쓰게 됨) APK를 새로 빌드한다 —
  // 그때는 코드를 고칠 때마다 다시 빌드·재설치해야 한다.
  //
  // 이 주소가 바뀌면(다른 ngrok 고정 도메인을 쓰게 되면) 여기와 .env.local의
  // NEXT_PUBLIC_API_URL을 함께 고치고, `npx cap sync android`로 APK에 다시 반영한 뒤
  // APK를 새로 설치해야 한다 — 그 뒤로는 다시 자동으로 받는다.
  server: {
    url: "https://54-66-15-115.sslip.io",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;

