package com.interior.pro;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GallerySaverPlugin.class);
        super.onCreate(savedInstanceState);

        // 이 앱은 로컬 파일 없이 server.url(원격 주소)을 그대로 연다. 배포 직후 폰이
        // 들고 있던 옛 캐시 문서가 삭제된 JS 청크를 가리키면 웹뷰 렌더러가 죽는데,
        // Capacitor 기본 동작은 이걸 처리하지 않고 그대로 앱 전체를 강제 종료한다 —
        // "켜졌다가 바로 창이 닫힌다"로 보이는 사고의 원인(2026-11-04). 여기서 받아
        // 앱을 끄는 대신 다시 띄워, 같은 원인이 다시 생겨도 사용자가 다시 열지
        // 않아도 복구되게 한다.
        getBridge()
            .addWebViewListener(
                new WebViewListener() {
                    @Override
                    public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                        if (webView != null) {
                            webView.destroy();
                        }
                        recreate();
                        return true;
                    }
                }
            );
    }
}
