"use client";

import { useEffect, useRef } from "react";

/** 안드로이드 하드웨어 '뒤로 가기'를 앱이 직접 처리한다.
 *
 *  [왜 필요한가]
 *  Capacitor WebView는 기본적으로 웹 히스토리가 없으면 뒤로 가기에 앱을 그냥 종료한다.
 *  이 앱은 한 페이지 안에서 단계(1·2·3)와 시트(단가 설정, 견적 불러오기)를 오가느라
 *  히스토리가 거의 쌓이지 않아서, 견적을 입력하던 중에 뒤로 가기를 누르면 작업이
 *  통째로 날아갔다.
 *
 *  [왜 리스너를 화면마다 붙이지 않고 한 개만 두는가]
 *  화면마다 App.addListener를 하면 뒤로 가기 한 번에 등록된 리스너가 전부 실행돼
 *  두 단계씩 뒤로 가거나, 한쪽이 history.back()을 부르는 동시에 다른 쪽이 종료를
 *  불러 버린다. 그래서 리스너는 이 모듈에 딱 하나만 두고, 화면들은 처리기를 쌓아
 *  올리기만 한다. 가장 나중에 열린 화면부터 물어보고, true를 돌려준 곳에서 멈춘다. */

type Handler = () => boolean;

const handlers: Handler[] = [];
let installed = false;
let lastExitPressAt = 0;

/** 두 번 눌러야 종료 — 한 번의 실수로 현장 견적이 날아가지 않게 한다. */
const EXIT_CONFIRM_MS = 2000;

async function install() {
  if (installed) return;
  installed = true;
  try {
    const { App } = await import("@capacitor/app");
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;

    await App.addListener("backButton", ({ canGoBack }) => {
      // 가장 위(가장 나중에 등록된) 화면부터 처리 기회를 준다.
      for (let i = handlers.length - 1; i >= 0; i--) {
        try {
          if (handlers[i]()) return;
        } catch {
          /* 한 화면의 처리기가 실패해도 아래 화면으로 계속 내려간다 */
        }
      }
      if (canGoBack) {
        window.history.back();
        return;
      }
      // 돌아갈 곳이 정말 없을 때만, 그것도 두 번 눌러야 종료한다.
      const now = Date.now();
      if (now - lastExitPressAt < EXIT_CONFIRM_MS) {
        App.exitApp();
        return;
      }
      lastExitPressAt = now;
      window.dispatchEvent(new CustomEvent("app:exit-hint"));
    });
  } catch {
    /* 웹 브라우저에는 플러그인이 없다 — 조용히 넘어간다 */
  }
}

/** handler가 true를 돌려주면 "내가 처리했다"는 뜻이라 뒤로 가기가 거기서 멈춘다. */
export function useAndroidBack(handler: Handler) {
  // 처리기는 한 번만 등록하고 최신 함수는 ref로 읽는다. 매 렌더마다 등록/해제하면
  // 누르는 순간 처리기가 없는 짧은 틈이 생긴다.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const entry: Handler = () => handlerRef.current();
    handlers.push(entry);
    void install();
    return () => {
      const i = handlers.indexOf(entry);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, []);
}
