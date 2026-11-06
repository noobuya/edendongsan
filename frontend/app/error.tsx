"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

/** 이 경로(및 그 아래) 어디서든 렌더링 중 처리 못한 예외가 터지면 Next.js가
 *  대신 이 화면을 보여준다.
 *
 *  [왜 — 2026-11-06 "앱 접속이 안 된다 — 화면이 하얗게만 남고 버튼이 반응 없다"]
 *  이 파일이 아예 없었다. App Router는 error.tsx가 없으면 처리 못한 렌더링
 *  예외가 터진 페이지 전체를 그냥 내려버린다(Next.js 11+ 기본 동작) — 화면이
 *  통째로 하얗게 변하고 아무 버튼도 안 눌리는 지금 신고된 증상과 정확히 같다.
 *  원인이 무엇이든(사장님 전용 코드의 드문 경로, 기기별 차이 등) 이 화면이
 *  있으면 최소한 "다시 시도" 버튼으로 복구할 길이 생긴다 — 원인을 못 찾은
 *  상태에서도 사용자가 완전히 막히지 않게 하는 안전망이다. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 콘솔에 남겨 둬야 실기기에서 원격 디버깅(USB)으로라도 원인을 나중에 볼 수 있다.
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-slate-50 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-rose-600">
        <RotateCcw className="h-7 w-7" />
      </div>
      <div>
        <p className="text-[17px] font-bold text-slate-900">화면에 문제가 생겼어요</p>
        <p className="mt-1.5 text-[13px] font-light text-slate-500">
          잠깐 오류가 있었어요. 다시 시도해도 똑같으면 완전히 새로고침해 주세요.
        </p>
        {/* 원인 파악용 — 같은 문제가 다시 생기면 이 문구를 그대로 캡처해서
            보여 주시면 정확한 원인을 바로 찾을 수 있다. */}
        <p className="mt-3 max-w-xs break-all text-[11px] font-mono text-slate-400">
          {error.message || "(메시지 없음)"}
          {error.digest ? ` · ${error.digest}` : ""}
        </p>
      </div>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-indigo-600 px-6 py-3 text-[14px] font-bold text-white transition-transform active:scale-95"
        >
          다시 시도
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full border border-slate-300 bg-white px-6 py-3 text-[14px] font-semibold text-slate-700 transition-transform active:scale-95"
        >
          새로고침
        </button>
      </div>
    </div>
  );
}
