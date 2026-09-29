"use client";

import type { NestingResult, PlacedPiece } from "@/lib/cutNesting";

const HATCH_ID = "cutmap-waste-hatch";

/** 조각 위에 라벨("문1")과 실제 치수("900×2100")를 함께 적는다. 조각이 가로로 넓으면
 *  글씨도 가로로, 걸레받이처럼 폭은 좁고 길이만 긴 조각이면 글씨를 90도 돌려 그
 *  긴 방향을 따라 눕힌다 — 모양에 맞춰 글씨의 방향과 줄 수를 스스로 고른다.
 *  (실제 글자 폭을 재지 않고 어림한 값이라, 아주 작은 조각은 라벨 없이 색만 칠한다.) */
function PieceLabel({ p, fontSize }: { p: PlacedPiece; fontSize: number }) {
  const cx = p.x + p.widthMm / 2;
  const cy = p.y + p.heightMm / 2;
  const fitsTwoLine = (along: number, across: number) => along >= fontSize * 6 && across >= fontSize * 2.6;
  const fitsOneLine = (along: number, across: number) => along >= fontSize * 1.8 && across >= fontSize * 1.3;

  let mode: "h2" | "v2" | "h1" | "v1" | null = null;
  if (fitsTwoLine(p.widthMm, p.heightMm)) mode = "h2";
  else if (fitsTwoLine(p.heightMm, p.widthMm)) mode = "v2";
  else if (fitsOneLine(p.widthMm, p.heightMm)) mode = "h1";
  else if (fitsOneLine(p.heightMm, p.widthMm)) mode = "v1";
  if (!mode) return null;

  const lines = mode.endsWith("2") ? [p.label, p.dimLabel] : [p.label];
  const dyStep = fontSize * 1.2;
  const startDy = lines.length === 2 ? -dyStep / 2 : 0;

  return (
    <g transform={mode.startsWith("v") ? `rotate(-90 ${cx} ${cy})` : undefined}>
      {lines.map((line, i) => (
        <text
          key={line}
          x={cx}
          y={cy + startDy + i * dyStep}
          fontSize={fontSize}
          fontWeight={i === 0 ? 800 : 600}
          fill="#0b0d12"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** 2D 재단 안내도. 원단을 실제 mm 단위 그대로(viewBox) 그려서, 화면 폭에 맞춰
 *  줄어들어도 조각들의 비율이 실제 크기와 정확히 같다 — 롤이 길면 그만큼 세로로
 *  길게 그려지고(실제로 그만큼 풀어 쓰는 거니까), 스크롤해서 끝까지 본다. */
export default function CutMapView({
  result,
  rollWidthMm,
  colorOf,
}: {
  result: NestingResult;
  rollWidthMm: number;
  colorOf: (groupKey: string) => string;
}) {
  const { shelves, totalLengthMm } = result;
  if (shelves.length === 0 || totalLengthMm <= 0) return null;

  // mm 단위 viewBox 안에서 라벨 글씨 크기 — 롤 폭의 일정 비율로 잡아야 화면 크기와
  // 무관하게 항상 같은 "느낌"으로 보인다.
  const fontSize = Math.round(rollWidthMm * 0.026);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#262b33] bg-[#0f1218]">
      <svg
        viewBox={`0 0 ${rollWidthMm} ${totalLengthMm}`}
        width="100%"
        preserveAspectRatio="xMidYMin meet"
        role="img"
        aria-label="2D 재단 안내도"
        className="block"
      >
        <defs>
          <pattern id={HATCH_ID} width={24} height={24} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width={24} height={24} fill="#1a1e25" />
            <line x1={0} y1={0} x2={0} y2={24} stroke="#2e343d" strokeWidth={8} />
          </pattern>
        </defs>

        <rect x={0} y={0} width={rollWidthMm} height={totalLengthMm} fill="#0f1218" />

        {shelves.map((shelf, si) => {
          const remnant = rollWidthMm - shelf.usedWidthMm;
          return (
            <g key={si}>
              {shelf.pieces.map((p) => (
                <g key={p.id}>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={p.widthMm}
                    height={p.heightMm}
                    fill={colorOf(p.groupKey)}
                    stroke="#0f1218"
                    strokeWidth={Math.max(2, rollWidthMm * 0.003)}
                    rx={Math.min(10, p.widthMm * 0.06)}
                  />
                  <PieceLabel p={p} fontSize={fontSize} />
                </g>
              ))}
              {/* 그 줄에서 남는 자투리 — 실제로 버려지는 폭이다 */}
              {remnant > 0 && (
                <rect x={shelf.usedWidthMm} y={shelf.y} width={remnant} height={shelf.heightMm} fill={`url(#${HATCH_ID})`} />
              )}
              {/* 줄 경계 = 여기서 가위로 자른다 */}
              {si > 0 && (
                <line
                  x1={0}
                  x2={rollWidthMm}
                  y1={shelf.y}
                  y2={shelf.y}
                  stroke="#4b5563"
                  strokeWidth={Math.max(2, rollWidthMm * 0.0025)}
                  strokeDasharray={`${rollWidthMm * 0.02} ${rollWidthMm * 0.014}`}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
