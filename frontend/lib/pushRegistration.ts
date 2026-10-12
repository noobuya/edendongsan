/** 실시간 알림(FCM 푸시) 기기 등록 — 사장님 기기와 조공/기공 기기가 공통으로 쓴다.
 *
 *  네이티브 앱(APK)에서만 동작한다 — Web Speech API와 달리 @capacitor/push-notifications는
 *  웹 플랫폼 자체를 아예 지원하지 않으므로, PC 브라우저·Capacitor 라이브 리로드 중인
 *  일반 웹뷰에서는 이 함수를 호출해도 조용히 아무 일도 안 한다.
 *
 *  Firebase 프로젝트 설정(google-services.json)이 아직 안 들어간 빌드에서는 register()
 *  자체가 실패하거나 토큰이 영원히 안 올 수 있다 — 그래도 앱 사용에는 지장이 없도록
 *  모든 실패를 조용히 삼킨다(음성인식과 같은 원칙: 부가 기능이 핵심 기능을 막으면 안 됨). */
export async function registerForPush(onToken: (token: string) => void): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;

    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== "granted") {
      const requested = await PushNotifications.requestPermissions();
      if (requested.receive !== "granted") return;
    }

    await PushNotifications.addListener("registration", (token) => {
      onToken(token.value);
    });
    await PushNotifications.addListener("registrationError", () => {
      // 조용히 무시 — 토큰을 못 받으면 그냥 이 기기엔 알림이 안 갈 뿐, 다른 기능엔 영향 없다.
    });
    await PushNotifications.register();
  } catch {
    // 플러그인이 없는 빌드(아직 APK 재빌드 전)이거나 네이티브 호출 자체가 실패해도 무시.
  }
}
