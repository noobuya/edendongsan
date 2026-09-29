import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        // 폴더블 커버 스크린(Z Flip 등, ~344~360px)에서도 버튼이 안 깨지도록 하는 최소 기준점
        xs: "360px",
        // 폴더블 펼친 화면(Z Fold ~673px, Fold 최신 세대 ~717px)에서 2열 레이아웃으로 전환
        fold: "673px",
        // 폴더블을 가로로 펼쳤을 때(Z Fold8 등)는 좌/우 분할 뷰로 전환
        foldLandscape: { raw: "(orientation: landscape) and (min-width: 700px)" },
      },
      // 카드는 테두리 선 대신 넓게 퍼지는 옅은 그림자로 배경에서 띄운다.
      // 선을 쓰면 카드가 많아질수록 화면이 격자처럼 딱딱해진다.
      boxShadow: {
        card: "0 8px 30px rgb(0 0 0 / 0.04)",
        "card-lg": "0 16px 50px rgb(0 0 0 / 0.07)",
        sheet: "0 -12px 40px rgb(0 0 0 / 0.08)",
      },
      keyframes: {
        // 바텀 시트가 화면 아래에서 스르륵 올라오는 네이티브 전환.
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // 단계가 넘어갈 때 살짝 밀려 들어오는 전환.
        "step-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
