"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, X } from "lucide-react";
import { ALL_PATTERN_SWATCHES, TONE_LABELS } from "@/lib/patternSwatches";
import type { PatternSwatch } from "@/types";

/** 현장에서 고객이 "따뜻한 느낌 필름지 뭐 있어요?"처럼 색상을 물을 때, 그 자리에서
 *  바로 걸러 보여주는 색상표. AI 렌더링(사진 위에 입히기)은 시간이 걸리고 비용이
 *  드는데다 사진이 있어야만 되는데, 이 화면은 카탈로그에 이미 있는 실제 색상·
 *  제품코드(현대보닥)를 즉시 톤별로 걸러서 보여주기만 하므로 사진 없이도, 기다릴
 *  필요 없이 바로 보여줄 수 있다 — "느낌"을 말로 설명하는 것보다 실제 색을 눈으로
 *  보고 고르는 게 훨씬 빠르다.
 *
 *  [왜 KCC는 아직 없는가] 보닥(BODAQ)은 공식 카탈로그의 실제 제품코드를 그대로
 *  옮겨 적어 발주에 바로 쓸 수 있다(catalog.py 참고). KCC도 같은 수준으로
 *  정확해야 발주 사고가 안 나는데, 아직 실제 제품코드·컬러명을 확인하지 못해
 *  임의로 지어 넣지 않았다 — 사장님이 실제로 쓰는 KCC 제품 라인업(코드·색상명)을
 *  알려주시면 그대로 추가한다. */
const TONE_FILTERS: { key: PatternSwatch["tone"] | "all"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "warm", label: "웜톤" },
  { key: "cool", label: "쿨톤" },
  { key: "neutral", label: "뉴트럴" },
  { key: "wood", label: "우드톤" },
];

// [왜 — 2026-11-07 "고객이 따뜻한 색을 원한다고 입력하면... 현대보닥 기준으로
// 말해줘"] 고객 말을 그대로 받아 톤을 짐작한다. 느낌을 말로 설명하는 것보다
// 실제 발주 가능한 보닥 품번으로 바로 짚어 주는 게 더 믿음직하다 — AI 호출
// 없이 키워드만 보고 즉시 판단하므로 기다릴 필요가 없다(현장에서 "바로"
// 보여줘야 하는 상황에 더 맞는다).
const TONE_KEYWORDS: { tone: PatternSwatch["tone"]; words: string[] }[] = [
  { tone: "warm", words: ["따뜻", "웜", "포근", "아늑", "베이지", "크림", "노란"] },
  { tone: "cool", words: ["차가운", "차갑", "쿨", "시원", "모던", "블루", "네이비", "그레이"] },
  { tone: "wood", words: ["나무", "우드", "원목", "내추럴", "오크", "월넛"] },
  { tone: "neutral", words: ["무난", "깔끔", "심플", "화이트", "기본", "편안"] },
];

function guessTone(query: string): PatternSwatch["tone"] | null {
  for (const { tone, words } of TONE_KEYWORDS) {
    if (words.some((w) => query.includes(w))) return tone;
  }
  return null;
}

// [왜 — 2026-11-08 "바닥 색상·벽지 종류·분위기를 입력하면 오늘의집 트렌드
// 기준으로 보닥/KCC 품번을 추천해줘"] "오늘의집 실시간 1위"처럼 구체적인
// 순위·통계는 실시간으로 확인할 방법이 없어 쓰지 않는다 — 확인 안 된 수치를
// 확신 있게 말하면 고객에게 거짓을 파는 것이다. 대신 "요즘 가장 선호도가
// 높은 조합입니다"처럼 일반적으로 맞는 트렌드는 애매하게 돌리지 않고
// 확신 있는 전문가 톤으로 말한다(사장님 요청, 2026-11-08) — "순위" 같은
// 특정 수치만 피하고 "선호도·정석 조합" 표현은 자신 있게 쓴다. 품번은
// 검증된 보닥 카탈로그로만 추천한다. 밝기(luminance)로 "화이트우드"는
// 밝은 우드, "클래식"은 짙은 우드를 가려 고른다 — 아래 RECOMMEND_DB가
// 이미 분위기별로 정확한 품번을 담고 있어 이제 밝기순 정렬은 필요 없다.
interface MoodPreset {
  key: string;
  label: string;
  reason: (floor: string, wallpaper: string) => string;
}
const MOOD_PRESETS: MoodPreset[] = [
  {
    key: "whitewood",
    label: "화이트우드",
    reason: (floor, wallpaper) =>
      `화이트우드는 요즘 인테리어 현장에서 가장 선호도가 높은 정석 조합입니다. ${floor || "밝은"} 바닥과 ${wallpaper || "화이트 톤"} 벽지에 밝은 우드를 매칭하면 공간이 넓고 화사해 보이면서도 나무 질감으로 포인트가 살아납니다.`,
  },
  {
    key: "modern",
    label: "모던",
    reason: (floor, wallpaper) =>
      `쿨톤 그레이·네이비는 모던한 분위기를 낼 때 가장 강력하게 추천하는 매칭입니다. ${floor || "무난한"} 바닥, ${wallpaper || "그레이 계열"} 벽지와 맞물려 또렷하고 정돈된 공간을 완성합니다.`,
  },
  {
    key: "minimal",
    label: "미니멀",
    reason: (floor, wallpaper) =>
      `뉴트럴 화이트·그레이는 미니멀 인테리어에서 가장 안전하고 세련된 선택입니다. ${floor || "밝은"} 바닥, ${wallpaper || "화이트"} 벽지와 시선을 분산시키지 않고 깔끔하게 어우러집니다.`,
  },
  {
    key: "cozy",
    label: "웜 내추럴",
    reason: (floor, wallpaper) =>
      `베이지·에크루 계열은 아늑한 공간을 원할 때 가장 먼저 권하는 정석 조합입니다. ${floor || "베이지"} 바닥, ${wallpaper || "웜톤"} 벽지와 톤을 맞춰 편안한 느낌을 완성합니다.`,
  },
  {
    key: "classic",
    label: "클래식",
    reason: (floor, wallpaper) =>
      `짙은 월넛·에스프레소 톤은 하이엔드 인테리어에서 가장 강력하게 추천하는 매칭입니다. ${floor || "짙은"} 바닥, ${wallpaper || "무게감 있는"} 벽지와 어우러져 고급스럽고 중후한 느낌을 완성합니다.`,
  },
];

interface BrandPick {
  brand: string;
  code: string;
  name: string;
  /** 공식 hex를 공개하지 않는 브랜드라 설명(색상명)을 보고 잡은 근사치 —
   *  카탈로그의 기존 보닥 색상들과 같은 원칙(화면 미리보기용일 뿐, 발주는
   *  브랜드·코드로 한다). */
  approxHex: string;
}
/** [왜 — 2026-11-08 사장님이 직접 제공한 현장 품번 DB] 브랜드 4곳(현대보닥·
 *  LX Z:IN·KCC·영림)의 베스트셀러 품번을 사장님이 현장 기준으로 알려준 그대로
 *  쓴다 — 더 이상 추측하지 않는다. MOOD_PRESETS의 5개 분위기와 정확히
 *  1:1로 맞물린다(화이트우드=밝은우드, 모던=무채색포인트, 미니멀=퓨어화이트,
 *  웜내추럴=웜화이트/크림, 클래식=짙은우드). [주의] 위 ALL_PATTERN_SWATCHES의
 *  기존 보닥 코드(예: 퓨어화이트=BLC05)와 아래 보닥 코드(퓨어화이트=S245)가
 *  서로 다르다 — 사장님 확인 대기 중. 두 데이터는 서로 다른 화면(스와치
 *  그리드 vs 이 맞춤 추천)에만 쓰여 지금은 충돌이 겉으로 드러나지 않지만,
 *  사장님이 어느 쪽이 맞는지 알려주시면 하나로 합친다. */
const RECOMMEND_DB: Record<string, BrandPick[]> = {
  minimal: [
    { brand: "현대보닥", code: "S245", name: "순백색 완전 무광", approxHex: "#FAFAF8" },
    { brand: "LX Z:IN", code: "ES130", name: "솔리드 무광 화이트", approxHex: "#F8F8F6" },
    { brand: "KCC", code: "PTW01", name: "무광 퓨어 화이트", approxHex: "#F7F7F5" },
    { brand: "영림", code: "PS071", name: "무광 퓨어 화이트", approxHex: "#F7F7F5" },
  ],
  cozy: [
    { brand: "현대보닥", code: "S115", name: "크림 화이트", approxHex: "#F2E8D5" },
    { brand: "LX Z:IN", code: "ES86", name: "크림 화이트", approxHex: "#F1E7D3" },
    { brand: "KCC", code: "PTW04", name: "웜 화이트", approxHex: "#F3E9D8" },
    { brand: "영림", code: "PS130", name: "크림 화이트", approxHex: "#F1E7D3" },
  ],
  whitewood: [
    { brand: "현대보닥", code: "W861", name: "잔잔한 내추럴 오크", approxHex: "#C9A878" },
    { brand: "LX Z:IN", code: "NW071", name: "내추럴 오크", approxHex: "#CBAA7A" },
    { brand: "KCC", code: "NW115", name: "내추럴 오크", approxHex: "#C8A877" },
    { brand: "영림", code: "PX449", name: "내추럴 오크", approxHex: "#CAA979" },
  ],
  classic: [
    { brand: "현대보닥", code: "W293", name: "다크 월넛", approxHex: "#4A3327" },
    { brand: "LX Z:IN", code: "NW043", name: "다크 월넛", approxHex: "#48311F" },
    { brand: "KCC", code: "NW062", name: "다크 우드", approxHex: "#432C1F" },
    { brand: "영림", code: "PX434", name: "월넛", approxHex: "#4A3325" },
  ],
  modern: [
    { brand: "현대보닥", code: "S208", name: "다크 그레이", approxHex: "#4B4F54" },
    { brand: "현대보닥", code: "NS804", name: "콘크리트 스톤", approxHex: "#8C8B86" },
    { brand: "LX Z:IN", code: "RS130", name: "다크 그레이", approxHex: "#4D5156" },
    { brand: "KCC", code: "PTS21", name: "다크 그레이", approxHex: "#4A4E53" },
    { brand: "영림", code: "PS044", name: "진그레이", approxHex: "#49494A" },
  ],
};

/** "현대보닥 S115와 KCC PTW04를 추천합니다" 형식의 한 줄 — 브랜드가 겹치면
 *  (예: "무채색 포인트"의 현대보닥 2종) 문장이 어색해지니, 브랜드당 하나만
 *  골라 최대 3곳까지 말해준다(세부 품번은 아래 카드 전부에서 볼 수 있다). */
function brandPickSentence(picks: BrandPick[]): string {
  const seen = new Set<string>();
  const unique = picks.filter((p) => (seen.has(p.brand) ? false : (seen.add(p.brand), true))).slice(0, 3);
  const parts = unique.map((p) => `${p.brand} ${p.code}`);
  if (parts.length === 1) return `${parts[0]}를 추천합니다.`;
  return `${parts.slice(0, -1).join(", ")}와 ${parts[parts.length - 1]}를 추천합니다.`;
}

// [왜 — 2026-11-08 "고객이 '벽지는 디아망으로 할 거예요'라고 말하면 자재
// 특성부터 분석해서 필름을 추천해줘"] 요청한 3단계(① 자재 특성 ② 왜 이
// 필름인지 논리 ③ 품번)는 그대로 쓰지만, 1단계를 "오늘의집 데이터"로
// 포장하지 않는다 — 오늘의집이 실제로 뭘 1위로 꼽는지 확인할 방법이 없다.
// 대신 그 자재 자체의 실제로 알려진 특징(질감·광택·두께감)은 정직한
// 일반 지식으로 자신 있게 설명한다 — 이건 지어내는 게 아니라 디아망·
// 블랙마루 같은 자재들의 널리 알려진 특성이다. 모르는 자재는 모른다고
// 하고 분위기 칩으로 안내한다(지어낸 설명을 붙이지 않는다).
interface MaterialKnowledge {
  keywords: string[];
  kind: "벽지" | "바닥";
  trait: string; // 1단계: 자재 특성
  logic: string; // 2단계: 그래서 이런 필름이어야 하는 이유
  moodKey: string; // 3단계에서 RECOMMEND_DB를 찾을 분위기 키
}
const MATERIAL_KB: MaterialKnowledge[] = [
  {
    keywords: ["디아망"],
    kind: "벽지",
    trait:
      "디아망은 LX Z:IN의 대표 실크 벽지로, 깊은 음영의 엠보싱 질감과 차분한 무광 톤이 특징입니다. 빛을 과하게 반사하지 않고 은은한 음영을 만들어내 하이엔드 주거 공간의 벽면 포인트로 자주 쓰입니다.",
    logic:
      "질감이 깊고 음영이 있는 벽지에 광택이나 나뭇결이 두드러지는 필름을 더하면 서로 부딪혀 촌스러워 보입니다. 빛 반사가 적은 완전 무광 솔리드 필름이어야 벽지의 질감을 해치지 않고 차분하게 어우러집니다.",
    moodKey: "modern",
  },
  {
    keywords: ["블랙마루", "블랙 마루", "흑단마루", "블랙 계열", "블랙계열"],
    kind: "바닥",
    trait: "짙은 블랙 계열 마루는 공간에 무게감과 고급스러움을 주지만, 면적이 넓으면 공간이 무겁고 좁게 느껴질 수 있습니다.",
    logic:
      "바닥이 이미 어둡고 무게감 있으므로, 문·몰딩까지 같이 짙게 가면 공간이 답답해 보일 위험이 있습니다. 중간 톤의 무채색 필름으로 바닥과 벽 사이에서 균형을 잡아주는 쪽이 안전합니다.",
    moodKey: "modern",
  },
  {
    keywords: ["화이트마루", "화이트 마루", "오크마루", "오크 마루"],
    kind: "바닥",
    trait: "화이트·오크 계열의 밝은 마루는 공간을 넓고 화사하게 보이게 하며, 어떤 벽지·필름과도 무난하게 어울리는 베이스입니다.",
    logic: "밝은 바닥에는 같은 계열의 밝은 우드나 화이트 계열 필름을 매칭해야 톤이 끊기지 않고 공간이 넓어 보입니다.",
    moodKey: "whitewood",
  },
  {
    keywords: ["콘크리트", "노출콘크리트", "노출 콘크리트"],
    kind: "벽지",
    trait: "노출 콘크리트 질감은 차갑고 거친 느낌을 주는 자재로, 인더스트리얼·시크한 분위기를 낼 때 주로 선택합니다.",
    logic: "거친 질감의 벽에는 매끈한 광택 필름보다 같은 계열의 무채색 매트 필름이 톤을 해치지 않고 시크한 분위기를 완성합니다.",
    moodKey: "modern",
  },
];

function findMaterials(query: string): MaterialKnowledge[] {
  const normalized = query.replace(/\s/g, "");
  return MATERIAL_KB.filter((m) => m.keywords.some((k) => normalized.includes(k.replace(/\s/g, ""))));
}

function groupByBrand(swatches: PatternSwatch[]): { label: string; items: PatternSwatch[] }[] {
  const groups: { label: string; items: PatternSwatch[] }[] = [];
  for (const s of swatches) {
    const label = s.brand ?? "기본 색상";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(s);
    else groups.push({ label, items: [s] });
  }
  return groups;
}

/** 작은 원 하나로는 "느낌"이 잘 안 산다 — 눌러서 화면을 거의 채우는 큰 색 면으로
 *  보여줘야 고객이 실제로 어떤 느낌인지 가늠할 수 있다. */
function SwatchDetail({ swatch, onClose }: { swatch: PatternSwatch; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 p-4" onClick={onClose}>
      <div
        className="mt-auto w-full overflow-hidden rounded-[28px] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[46vh] w-full" style={{ backgroundColor: swatch.colorHex }} />
        <div className="flex items-start justify-between gap-3 p-6">
          <div>
            <p className="text-[20px] font-extrabold tracking-tight text-[#191f28]">{swatch.name}</p>
            <p className="mt-1 text-[13px] text-[#5b6573]">
              {swatch.brand ? `${swatch.brand}${swatch.code ? ` · ${swatch.code}` : ""}` : "기본 색상"}
              {" · "}
              {TONE_LABELS[swatch.tone]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f2f4f6] text-[#4e5968]"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ColorsPage() {
  const [tone, setTone] = useState<PatternSwatch["tone"] | "all">("all");
  const [opened, setOpened] = useState<PatternSwatch | null>(null);
  const [query, setQuery] = useState("");
  // null = 아직 검색 안 함, "none" = 검색했지만 못 알아들음, 그 외엔 짚어낸 톤.
  const [answer, setAnswer] = useState<PatternSwatch["tone"] | "none" | null>(null);

  // 맞춤 추천(바닥·벽지·분위기) 입력값.
  const [floorColor, setFloorColor] = useState("");
  const [wallpaper, setWallpaper] = useState("");
  const [mood, setMood] = useState<MoodPreset | null>(null);

  // 자재 키워드로 상담하기("벽지는 디아망으로, 바닥은 블랙 마루로...").
  const [materialQuery, setMaterialQuery] = useState("");
  // null = 아직 분석 안 함, [] = 분석했지만 아는 자재가 없음.
  const [materialMatches, setMaterialMatches] = useState<MaterialKnowledge[] | null>(null);

  function handleSearch() {
    const guessed = guessTone(query.trim());
    if (guessed) {
      setTone(guessed);
      setAnswer(guessed);
    } else {
      setAnswer("none");
    }
  }

  function handleMaterialAnalyze() {
    setMaterialMatches(findMaterials(materialQuery));
  }

  const filtered = useMemo(
    () => (tone === "all" ? ALL_PATTERN_SWATCHES : ALL_PATTERN_SWATCHES.filter((s) => s.tone === tone)),
    [tone]
  );
  const groups = useMemo(() => groupByBrand(filtered), [filtered]);

  // 답변은 항상 발주 가능한 실제 품번(현대보닥) 기준으로 말해준다 — 기본 10색은
  // 품번이 없어 고객에게 "이건 뭐예요?" 되물어도 답해 줄 자재 정보가 없다.
  const bodaqPicks = useMemo(() => {
    if (!answer || answer === "none") return [];
    return ALL_PATTERN_SWATCHES.filter((s) => s.tone === answer && s.brand).slice(0, 3);
  }, [answer]);

  return (
    <main className="min-h-screen min-h-[100dvh] bg-[#f2f4f6] text-[#191f28]">
      <div className="mx-auto max-w-[480px] px-4 pb-16 pt-4">
        <header className="mb-5">
          <Link
            href="/"
            className="-ml-2 inline-flex h-11 items-center gap-1 rounded-xl px-2 text-[14px] font-medium text-[#4e5968] transition-colors active:bg-black/5"
          >
            <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
            메인으로
          </Link>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-[-0.03em]">색상 상담</h1>
          <p className="mt-1.5 text-[15px] text-[#5b6573]">
            고객이 말한 느낌을 그대로 입력하거나, 아래에서 눌러 바로 걸러 보세요.
          </p>
        </header>

        <section className="rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(25,31,40,0.04)]">
          <h2 className="text-[16px] font-bold">맞춤 추천</h2>
          <p className="mt-1 text-[13px] text-[#5b6573]">
            바닥·벽지를 적어 두면(생략 가능) 분위기에 맞춰 추천 멘트에 그대로 반영됩니다.
          </p>
          <div className="mt-3 space-y-2.5">
            <input
              type="text"
              value={floorColor}
              onChange={(e) => setFloorColor(e.target.value)}
              placeholder="바닥 색상 (예: 화이트, 라이트 우드)"
              className="h-11 w-full rounded-xl border border-[#e5e8eb] bg-[#f8f9fa] px-3.5 text-[14px] outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              value={wallpaper}
              onChange={(e) => setWallpaper(e.target.value)}
              placeholder="벽지 종류 (예: 무지 화이트, 베이지 톤)"
              className="h-11 w-full rounded-xl border border-[#e5e8eb] bg-[#f8f9fa] px-3.5 text-[14px] outline-none focus:border-indigo-500"
            />
          </div>
          <p className="mb-2 mt-3.5 text-[12.5px] font-bold text-[#8b95a1]">원하는 분위기</p>
          <div className="flex flex-wrap gap-2">
            {MOOD_PRESETS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMood(m)}
                className={`h-9 rounded-full px-3.5 text-[13.5px] font-bold transition-colors ${
                  mood?.key === m.key ? "bg-indigo-600 text-white" : "bg-[#f2f4f6] text-[#4e5968]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mood && (
            <div className="mt-4 rounded-2xl bg-indigo-600 px-4 py-4 text-white">
              <p className="text-[13.5px] leading-relaxed">
                {mood.reason(floorColor.trim(), wallpaper.trim())}{" "}
                {brandPickSentence(RECOMMEND_DB[mood.key] ?? [])}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {(RECOMMEND_DB[mood.key] ?? []).map((p) => (
                  <div key={`${p.brand}-${p.code}`} className="flex items-center gap-2 rounded-xl bg-white px-2.5 py-2 text-[#191f28]">
                    <span
                      className="h-8 w-8 shrink-0 rounded-full border border-black/5"
                      style={{ backgroundColor: p.approxHex }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-bold leading-tight">
                        {p.brand} {p.code}
                      </p>
                      <p className="truncate text-[11px] text-[#8b95a1]">{p.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="mt-5 rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(25,31,40,0.04)]">
          <h2 className="text-[16px] font-bold">자재로 상담하기</h2>
          <p className="mt-1 text-[13px] text-[#5b6573]">
            고객이 말한 자재를 그대로 적으면, 그 자재의 특성과 어울리는 이유까지 짚어줍니다.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={materialQuery}
              onChange={(e) => setMaterialQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleMaterialAnalyze()}
              placeholder="예: 벽지는 디아망으로, 바닥은 블랙 마루로 할 거예요"
              className="h-12 min-w-0 flex-1 rounded-2xl border border-[#e5e8eb] bg-[#f8f9fa] px-4 text-[15px] outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleMaterialAnalyze}
              aria-label="자재 분석"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white active:scale-95"
            >
              <Search className="h-5 w-5" strokeWidth={2.25} />
            </button>
          </div>

          {materialMatches && materialMatches.length === 0 && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-800">
              아직 아는 자재가 아니에요. 디아망·블랙마루·화이트마루·오크마루·노출콘크리트
              같은 이름으로 다시 적어 주시거나, 위 "맞춤 추천"에서 분위기로 골라 보세요.
            </p>
          )}

          {materialMatches && materialMatches.length > 0 && (
            <div className="mt-3 space-y-3">
              {materialMatches.map((m) => {
                const picks = RECOMMEND_DB[m.moodKey] ?? [];
                return (
                  <div key={m.keywords[0]} className="rounded-2xl bg-[#f8f9fa] p-4">
                    <p className="text-[12.5px] font-bold text-indigo-600">
                      {m.kind} 특성
                    </p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-[#191f28]">{m.trait}</p>
                    <p className="mt-3 text-[12.5px] font-bold text-indigo-600">왜 이 필름인지</p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-[#191f28]">{m.logic}</p>
                    <p className="mt-3 text-[12.5px] font-bold text-indigo-600">추천 품번</p>
                    <p className="mt-1 text-[13.5px] font-semibold leading-relaxed text-[#191f28]">
                      {brandPickSentence(picks)}
                    </p>
                    <div className="mt-2 flex gap-2">
                      {picks.slice(0, 4).map((p) => (
                        <div key={`${p.brand}-${p.code}`} className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5">
                          <span className="h-4 w-4 shrink-0 rounded-full border border-black/5" style={{ backgroundColor: p.approxHex }} />
                          <span className="whitespace-nowrap text-[11px] font-bold">{p.brand} {p.code}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="mt-5 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="예: 따뜻한 색, 차가운 느낌, 나무 느낌…"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-[#e5e8eb] bg-white px-4 text-[15px] outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handleSearch}
            aria-label="색상 찾기"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white active:scale-95"
          >
            <Search className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>

        {answer === "none" && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-800">
            무슨 느낌인지 못 알아들었어요. "따뜻한", "차가운", "나무", "무난한" 같은
            말로 다시 말해 주시거나, 아래 칩을 눌러 직접 골라 보세요.
          </p>
        )}
        {answer && answer !== "none" && (
          <div className="mt-3 rounded-2xl bg-indigo-600 px-4 py-4 text-white">
            <p className="text-[14px] leading-relaxed">
              <b>"{query}"</b>이시면 <b>현대보닥</b> 중에서 이런 색이 잘 맞아요
            </p>
            <div className="mt-3 flex gap-3">
              {bodaqPicks.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setOpened(s)}
                  className="flex-1 overflow-hidden rounded-xl bg-white text-left text-[#191f28] active:scale-95"
                >
                  <div className="h-12 w-full" style={{ backgroundColor: s.colorHex }} />
                  <div className="px-2 py-1.5">
                    <p className="truncate text-[12px] font-bold leading-tight">{s.name}</p>
                    <p className="text-[11px] text-[#8b95a1]">{s.code}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {TONE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setTone(f.key);
                setAnswer(null);
              }}
              className={`h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-[14px] font-bold transition-colors ${
                tone === f.key ? "bg-indigo-600 text-white" : "bg-white text-[#4e5968]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-6">
          {groups.map((group) => (
            <section key={group.label}>
              <p className="mb-2.5 px-1 text-[12.5px] font-bold uppercase tracking-wide text-[#8b95a1]">
                {group.label}
              </p>
              <div className="grid grid-cols-3 gap-3">
                {group.items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setOpened(s)}
                    className="overflow-hidden rounded-2xl bg-white text-left shadow-[0_1px_2px_rgba(25,31,40,0.04)] transition-transform active:scale-95"
                  >
                    <div className="h-16 w-full" style={{ backgroundColor: s.colorHex }} />
                    <div className="px-2.5 py-2">
                      <p className="truncate text-[12.5px] font-bold leading-tight">{s.name}</p>
                      {s.code && <p className="mt-0.5 text-[11px] text-[#8b95a1]">{s.code}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-[14px] text-[#8b95a1]">해당 느낌의 색상이 아직 없습니다</p>
          )}
        </div>
      </div>

      {opened && <SwatchDetail swatch={opened} onClose={() => setOpened(null)} />}
    </main>
  );
}
