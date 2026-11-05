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
        // "켜졌다가 바로 창이 닫힌다"로 보이는 사고의 원인(2026-11-04).
        //
        // [왜 2026-11-05에 webView.destroy()+recreate()를 빼고 같은 웹뷰에 다시
        // 로드만 하도록 고쳤는가 — "또 꺼지고 이번엔 오류 메시지까지 뜬다"]
        // 처음엔 웹뷰를 destroy()한 뒤 액티비티를 recreate()했는데, Capacitor의
        // Bridge도 같은 액티비티 생명주기에 물려 같은 웹뷰를 정리하려 든다 — 이미
        // 수동으로 destroy()해 버린 웹뷰를 recreate()가 트리거한 정상 종료 절차가
        // 또 건드리면서 충돌해 새로운 크래시를 냈다(이번 사고의 "오류 메시지"가
        // 그 흔적). 렌더러가 죽어도 WebView 객체 자체(과 주소)는 살아 있으므로,
        // 액티비티를 통째로 다시 만들 필요 없이 같은 웹뷰에 같은 주소를 다시
        // 로드하기만 하면 안드로이드가 새 렌더러 프로세스를 알아서 띄운다 — 액티비티
        // 생명주기를 건드리지 않아 Capacitor Bridge와 충돌할 여지가 없다.
        getBridge()
            .addWebViewListener(
                new WebViewListener() {
                    @Override
                    public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                        if (webView != null && webView.getUrl() != null) {
                            webView.loadUrl(webView.getUrl());
                        }
                        return true;
                    }
                }
            );
    }
}
