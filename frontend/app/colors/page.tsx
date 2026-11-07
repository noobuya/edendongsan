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

  function handleSearch() {
    const guessed = guessTone(query.trim());
    if (guessed) {
      setTone(guessed);
      setAnswer(guessed);
    } else {
      setAnswer("none");
    }
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

        <div className="flex gap-2">
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
