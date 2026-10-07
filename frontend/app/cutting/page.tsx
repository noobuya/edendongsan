"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  AppWindow,
  ArrowLeft,
  BrickWall,
  CheckSquare,
  DoorClosed,
  Info,
  LayoutGrid,
  Mic,
  Minus,
  Plus,
  Ruler,
  Square,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import CutMapView from "@/components/cutting/CutMapView";
import { packShelves, type NestingPiece, type NestingShelf } from "@/lib/cutNesting";

// 필름 원단의 표준 장폭. app/services/estimator.py가 실제 견적을 낼 때 쓰는 값과 같다 —
// 이 현장 도구가 계산한 길이와 나중에 뜨는 정식 견적의 원단 길이가 서로 다른 숫자로
// 보이면 사장님이 어느 쪽을 믿어야 할지 헷갈린다.
const ROLL_WIDTH_MM = 1220;
const DEFAULT_LOSS_PERCENT = 15;

// [필름 시공 절대 규칙]
// 1) 원단 폭은 무조건 1,220mm 고정(위 ROLL_WIDTH_MM).
// 2) 여유분(사방 랩핑 마진)은 업계 표준인 30~50mm를 절대 벗어나지 않는다 — 두께가
//    있으면(두께+20mm) 그만큼 필요하지만, 얇거나 두께가 0인 부위도 30mm 밑으로는
//    절대 안 내려간다. 현장마다 시접 등으로 더 필요하면 옵셋으로 위쪽(30mm 이상)으로만
//    보정한다(음수를 넣어도 30mm 밑으로는 안 떨어진다).
// 3) 결(무늬) 방향 고정 — 원단을 아끼겠다고 조각을 90도 돌려 끼우지 않는다
//    (lib/cutNesting.ts의 packShelves가 회전을 아예 지원하지 않는다).
// 4) 재단 자체도 눈금 단위로 끊어서 하므로, 계산한 치수를 그 단위로 올림한다 —
//    가로는 10mm 단위, 세로(긴 길이 방향)는 50mm 단위.
const MARGIN_EXTRA_MM = 20;
const MARGIN_MIN_MM = 30; // 업계 표준 사방 여유분의 하한(30~50mm) — 절대 이 밑으로 안 내려간다
const CUT_STEP_W_MM = 10;
const CUT_STEP_H_MM = 50;
const MARGIN_OFFSET_STEP_MM = 5;
const QTY_MIN = 1;
const QTY_MAX = 20;

type Category = "sash" | "door" | "cabinet" | "decor" | "molding" | "wall";

// [문짝 파라메트릭 도안 시스템 — 현장 실무 피드백 반영]
// 문짝이 전부 평평한 통판(민짜문)은 아니다. 알판/격자문은 홈이 파여 있어 통판 한 장으로
// 덮을 수 없고, 세로 기둥(스타일) + 가로대(레일) + 알판(안쪽 패널)을 따로 재단해 겹쳐
// 붙이는 덧방 시공을 한다. 기공이 이 조각들을 일일이 손으로 계산하게 만들면 안 되므로,
// "몇 칸(rows×cols)으로 나뉘어 있는지"만 도안으로 정해 주면 나머지(기둥·가로대·알판
// 몇 개를 어떤 치수로 잘라야 하는지)는 앱이 전부 계산한다 — 사용자는 가로(W)·세로(H)·
// 기둥/가로대 폭(F) 딱 3개만 입력한다.
interface DoorLayout {
  id: string;
  label: string;
  /** 세로(높이) 분할 칸 수. 0이면 민짜문(분해하지 않는다). */
  rows: number;
  /** 가로(폭) 분할 칸 수. 0이면 민짜문. */
  cols: number;
  /** false면 칸 안쪽에 필름 조각을 내지 않는다 — 유리를 끼우는 타공문. */
  hasPanel: boolean;
}
const DOOR_LAYOUTS: DoorLayout[] = [
  { id: "flat", label: "민짜문", rows: 0, cols: 0, hasPanel: true },
  { id: "panel_1x1", label: "1구 알판", rows: 1, cols: 1, hasPanel: true },
  { id: "panel_2x1", label: "2구 상하 알판", rows: 2, cols: 1, hasPanel: true },
  { id: "cross_2x2", label: "십자 격자", rows: 2, cols: 2, hasPanel: true },
  { id: "glass_1x1", label: "타공문(유리)", rows: 1, cols: 1, hasPanel: false },
];
function doorLayoutOf(id: string): DoorLayout {
  return DOOR_LAYOUTS.find((l) => l.id === id) ?? DOOR_LAYOUTS[0];
}
/** 도안이 몇 조각으로 쪼개지는지 — 기둥(cols+1) + 가로대(rows+1) + (있다면) 알판(rows×cols). */
function pieceCountOf(layout: DoorLayout): number {
  if (layout.rows <= 0 || layout.cols <= 0) return 1;
  return layout.cols + 1 + (layout.rows + 1) + (layout.hasPanel ? layout.rows * layout.cols : 0);
}
const DEFAULT_FRAME_WIDTH_MM = 120; // 기둥·가로대(테두리) 폭의 현장 통용 기본값 — 화면에서 바로 고칠 수 있다
// 문짝만 이 구조 선택지가 의미 있다(문틀/상하부장 등은 애초에 통판 개념이 없다).
const DOOR_LIKE_CATEGORIES: Category[] = ["door", "cabinet", "decor"];

// [문짝은 입체다 — 기본적으로 앞/뒤 양면 시공]
// 방문은 벽에 매달려 양쪽에서 다 보이는 입체물이라, 원칙적으로 앞면·뒷면 둘 다 필름을
// 감싼다. "문짝(panel)"은 앞뒤 두 장을 따로 재단하고, "문틀(frame)"은 앞 문선·기둥
// 두께·뒷 문선을 한 번에 감아 두르는 'ㄷ자' 띠장이라 애초에 한 조각에 양면이 들어간다
// — 그래서 이 둘은 "양면"이 서로 다른 방식으로 반영된다(아래 buildDoorFrameCasingPieces,
// applyDoorSided 참고). "door" 카테고리에서만 의미 있다(싱크대/옷장 도어는 뒷면이 몸체
// 안쪽에 가려져 보통 한쪽만 시공한다).
type DoorPart = "panel" | "frame";
type DoorSided = "double" | "single";
const DEFAULT_FRONT_CASING_MM = 35; // 앞 문선 폭 현장 통용 기본값
const DEFAULT_JAMB_DEPTH_MM = 100; // 기둥(벽) 두께 현장 통용 기본값
const DEFAULT_BACK_CASING_MM = 35; // 뒤 문선 폭 현장 통용 기본값

interface Preset {
  label: string;
  wMm?: number;
  hMm?: number;
  lengthM?: number;
  stripWidthMm?: number;
}

interface CategoryConfig {
  id: Category;
  label: string;
  /** 재단 안내도·리스트에서 쓰는 한 글자 표식. */
  shortLabel: string;
  icon: LucideIcon;
  tone: string;
  /** 2D 재단 안내도에서 이 부위 조각을 칠하는 색(HEX) — SVG fill은 tailwind 클래스를 못 읽는다. */
  mapColor: string;
  /** 몰딩/걸레받이는 가로×세로가 아니라 "길이(m) × 폭(mm)"의 띠 모양이라 입력 UI가 다르다. */
  linear: boolean;
  defaultThicknessMm: number;
  defaultStripWidthMm?: number;
  /** 문짝류·샷시처럼 "테두리 폭"을 입력받는 부위의 기본값(mm) — 부위마다 현장 통용 치수가 달라서
   *  (문짝은 120mm 내외, 샷시는 50~100mm) 부위별로 따로 둔다. */
  defaultFrameWidthMm?: number;
  note: string;
  /** 원터치로 바로 리스트에 추가하는 표준 규격(한국 아파트 통용 치수). */
  presets: Preset[];
}

const CATEGORIES: CategoryConfig[] = [
  {
    id: "sash",
    label: "샷시",
    shortLabel: "샷",
    icon: AppWindow,
    tone: "bg-sky-500/15 text-sky-300",
    mapColor: "#38bdf8",
    linear: false,
    defaultThicknessMm: 0,
    defaultFrameWidthMm: 75,
    note: "가운데는 유리라 통판으로 재단하지 않아요 — 테두리 띠장 4개로 자동 분해됩니다",
    presets: [],
  },
  {
    id: "door",
    label: "문틀/문짝",
    shortLabel: "문",
    icon: DoorClosed,
    tone: "bg-indigo-500/15 text-indigo-300",
    mapColor: "#818cf8",
    linear: false,
    defaultThicknessMm: 0,
    defaultFrameWidthMm: DEFAULT_FRAME_WIDTH_MM,
    note: "문짝 옆면(두께)까지 감싸 시공한다면 두께를 입력하세요",
    presets: [{ label: "방문", wMm: 900, hMm: 2100 }],
  },
  {
    id: "cabinet",
    label: "싱크대/옷장 도어",
    shortLabel: "싱",
    icon: LayoutGrid,
    tone: "bg-amber-500/15 text-amber-300",
    mapColor: "#fbbf24",
    linear: false,
    defaultThicknessMm: 18,
    defaultFrameWidthMm: DEFAULT_FRAME_WIDTH_MM,
    note: "도어 두께(보통 18~20mm)만큼 옆면을 감싸 계산합니다",
    presets: [{ label: "싱크대 도어", wMm: 400, hMm: 800 }],
  },
  {
    id: "decor",
    label: "장식장",
    shortLabel: "장",
    icon: Archive,
    tone: "bg-violet-500/15 text-violet-300",
    mapColor: "#a78bfa",
    linear: false,
    defaultThicknessMm: 18,
    defaultFrameWidthMm: DEFAULT_FRAME_WIDTH_MM,
    note: "장식장 문짝 두께(보통 15~18mm)만큼 옆면을 감싸 계산합니다. 크기가 제각각이라 표준 규격은 없어요",
    presets: [],
  },
  {
    id: "molding",
    label: "걸레받이/몰딩",
    shortLabel: "걸",
    icon: Ruler,
    tone: "bg-emerald-500/15 text-emerald-300",
    mapColor: "#34d399",
    linear: true,
    defaultThicknessMm: 0,
    defaultStripWidthMm: 150,
    note: "긴 길이(m) 기준 — 양 끝에만 여유분을 둡니다",
    presets: [{ label: "걸레받이", lengthM: 2.4, stripWidthMm: 100 }],
  },
  {
    id: "wall",
    label: "벽면",
    shortLabel: "벽",
    icon: BrickWall,
    tone: "bg-rose-500/15 text-rose-300",
    mapColor: "#fb7185",
    linear: false,
    defaultThicknessMm: 0,
    note: "벽마다 크기가 달라 표준 규격이 없어요 — 가로×세로 실측을 입력하세요",
    presets: [],
  },
];

function categoryOf(id: Category): CategoryConfig {
  return CATEGORIES.find((c) => c.id === id)!;
}

interface CutItem {
  id: string;
  category: Category;
  seq: number;
  // 패널(샷시/문짝/도어)
  wMm?: number;
  hMm?: number;
  // 몰딩
  lengthM?: number;
  stripWidthMm?: number;
  // 공통
  dMm: number;
  /** 실제로 적용된 사방 여유분(두께 + 20mm + 옵셋) — 자동 계산값이라 항목마다 기록해 둔다. */
  marginMm: number;
  /** 그중 사장님이 더하거나 뺀 옵셋 몫만 따로. */
  marginOffsetMm: number;
  cutWMm: number;
  cutHMm: number;
  areaM2: number;
  checked: boolean;
  /** 알판/격자문·타공문처럼 한 짝이 여러 조각으로 쪼개질 때 그 조각이 무엇인지
   *  ("기둥-좌"/"가로대-상"/"알판" 등). 민짜문(통판 한 장)이면 비어 있다. */
  part?: string;
  /** 이 조각이 속한 문짝의 도안(DOOR_LAYOUTS의 id). 리스트·안내도에서 왜 여러 줄로
   *  쪼개졌는지 보여줄 때 쓴다. */
  doorLayout?: string;
}

const STORAGE_KEY = "eden_cutting_list_v1";
const EMPTY_SEQ: Record<Category, number> = { sash: 0, door: 0, cabinet: 0, decor: 0, molding: 0, wall: 0 };

/** localStorage에 저장해 둔 재단 리스트를 읽는다. 컴포넌트 state를 만드는 시점에
 *  (useState의 지연 초기화로) 바로 불러 써야 저장/불러오기 순서가 어긋날 일이 없다. */
function readStoredCutting(): { items: CutItem[]; lossPercent?: string; marginOffsetMm?: string } {
  if (typeof window === "undefined") return { items: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [] };
    const saved = JSON.parse(raw) as { items?: CutItem[]; lossPercent?: string; marginOffsetMm?: string };
    return { items: saved.items ?? [], lossPercent: saved.lossPercent, marginOffsetMm: saved.marginOffsetMm };
  } catch {
    return { items: [] }; // 저장된 값이 깨져 있어도 빈 리스트로 시작한다
  }
}

/** 불러온 리스트에 이미 "샷시 3" 같은 항목이 있으면, 다음 항목 번호가 그 뒤(4)부터
 *  이어지게 부위별 최대 번호를 계산해 둔다. */
function initialSeqMap(items: CutItem[]): Record<Category, number> {
  const seq = { ...EMPTY_SEQ };
  for (const it of items) seq[it.category] = Math.max(seq[it.category], it.seq);
  return seq;
}

function won2(n: number, digits = 2): string {
  return n.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/** 패널 하나의 실제 재단 치수. 여유분(사방) = 두께 + 20mm + 옵셋을 가로·세로 양쪽에
 *  두르고, 마지막으로 재단 눈금 단위(가로 10mm·세로 50mm)로 올림한다 — 실제로 그
 *  단위로만 끊어 자르기 때문에, 어중간한 mm는 어차피 다음 눈금까지 잘려 나간다. */
function computePanel(wMm: number, hMm: number, dMm: number, offsetMm: number) {
  // 업계 절대 규칙: 사방 여유분은 30mm 밑으로 절대 안 내려간다. 두께가 있으면
  // 두께+20mm이 30mm를 넘어서므로 그 값을 쓰고, 얇은 부위라도 30mm는 보장한다.
  // 옵셋은 그 위에 더(음수도 가능하지만)만 조정 — 최종값도 30mm 밑으로는 안 뺀다.
  const marginMm = Math.max(MARGIN_MIN_MM, dMm + MARGIN_EXTRA_MM + offsetMm);
  const cutWMm = roundUpTo(wMm + marginMm * 2, CUT_STEP_W_MM);
  const cutHMm = roundUpTo(hMm + marginMm * 2, CUT_STEP_H_MM);
  return { marginMm, cutWMm, cutHMm, areaM2: (cutWMm / 1000) * (cutHMm / 1000) };
}

/** 몰딩(걸레받이)은 감싸는 두께가 없는 납작한 띠라도, 사방 여유분 30mm 하한 규칙은
 *  똑같이 적용된다. 길이(긴 방향)만 세로 눈금(50mm)으로 올림한다. 폭은 재단하는
 *  값이 아니라 이미 그 폭으로 나온 원단이라 그대로 둔다. */
function computeMolding(lengthM: number, stripWidthMm: number, offsetMm: number) {
  const marginMm = Math.max(MARGIN_MIN_MM, MARGIN_EXTRA_MM + offsetMm);
  const cutWMm = roundUpTo(lengthM * 1000 + marginMm * 2, CUT_STEP_H_MM);
  const cutHMm = stripWidthMm;
  return { marginMm, cutWMm, cutHMm, areaM2: (cutWMm / 1000) * (cutHMm / 1000) };
}

interface DoorFramePieceSpec {
  part: string;
  wMm: number;
  hMm: number;
}

// [겹침 덧방 마진(시접) — 조인트에서 필름이 겹치도록]
// 실제 시공 순서는 기둥(바닥층) → 가로대(기둥 위에 겹쳐 붙임) → 알판(맨 나중에 오려
// 끼워 넣음) 순이다. 그래서 기둥은 원래 치수 그대로 재단하고, 가로대는 기둥과 맞닿는
// 양쪽 끝을 시접만큼 더 길게 재단해 기둥 위로 살짝 겹치게 하고, 알판은 사방을 시접만큼
// 더 크게 재단해 둘레 프레임 밑으로 겹쳐 넣고 다듬는다 — 셋 다 겹치게 하면 과하므로
// "나중에 얹는 조각이 오버사이즈"라는 한 가지 규칙으로 통일했다.
const JOINT_SEAM_MM = 15; // 현장 시접 10~20mm의 중간값을 자동 적용(추가 입력 없이 알고리즘이 넣는다)

/** 알판/격자문·타공문의 R행×C열 도안을 실제로 어떻게 나눠 재단하는지 계산한다 —
 *  세로 기둥(좌·우 + 안쪽 분할대) + 가로대(상·하 + 안쪽 분할대) + (있다면) 알판들.
 *  안쪽 분할대(세로)는 위아래 가로대 사이 길이로, 안쪽 분할대(가로)는 좌우 기둥 사이
 *  길이로 잡는다 — 바깥쪽 프레임을 기준 삼아 걸치는 구조라 몇 칸으로 나뉘든 같은
 *  규칙 하나로 계산된다. 유리 타공문(hasPanel=false)은 알판 조각이 없다(그 자리엔
 *  필름을 안 감싼다).
 *
 *  [결 방향(우라) 고정 — 왜 가로대는 w/h를 뒤집어 넣는가]
 *  이 파일의 nesting 축 관례는 "cutHMm(세로) = 롤이 풀리는 방향 = 필름 결(그레인) 방향"이다
 *  (packShelves가 절대 회전하지 않기 때문에, 어느 축을 cutHMm에 넣느냐가 곧 결 방향이 된다).
 *  기둥은 원래도 좁고 길쭉해 그 긴 방향(문 높이)이 결 방향과 자연히 맞는다.
 *  가로대는 실치수로는 "가로로 넓고 세로로 얕은" 띠지만, 설치했을 때 결이 세로로
 *  보이려면 그 얕은 폭(프레임폭) 쪽이 롤의 결 방향 축에 들어가야 한다 — 그래서
 *  computePanel(가로대 길이, 프레임폭, …)처럼 짧은 쪽을 h 자리에 넣어, 가로대를 가로로
 *  길게 재단하면서도 결만은 세로로 고정한다. 알판도 h 자리에 문 높이 쪽을 넣어 결이
 *  세로로 맞게 한다. */
function buildDoorFramePieces(wMm: number, hMm: number, frameWidthMm: number, layout: DoorLayout): DoorFramePieceSpec[] | null {
  const { rows, cols, hasPanel } = layout;
  if (rows <= 0 || cols <= 0 || frameWidthMm <= 0) return null;

  const stileInnerH = hMm - frameWidthMm * 2; // 안쪽 세로 분할대 길이(위아래 가로대 사이)
  const railSpanW = wMm - frameWidthMm * 2; // 모든 가로대의 실제 길이(좌우 기둥 사이)
  if (stileInnerH <= 0 || railSpanW <= 0) return null;

  const panelW = (wMm - frameWidthMm * (cols + 1)) / cols;
  const panelH = (hMm - frameWidthMm * (rows + 1)) / rows;
  if (panelW <= 0 || panelH <= 0) return null;

  const pieces: DoorFramePieceSpec[] = [];
  pieces.push({ part: "기둥-좌", wMm: frameWidthMm, hMm: hMm });
  pieces.push({ part: "기둥-우", wMm: frameWidthMm, hMm: hMm });
  for (let i = 1; i < cols; i++) {
    pieces.push({ part: cols === 2 ? "기둥-중" : `기둥-중${i}`, wMm: frameWidthMm, hMm: stileInnerH });
  }

  const railW = railSpanW + JOINT_SEAM_MM * 2; // 기둥과 겹치도록 양쪽 끝에 시접
  pieces.push({ part: "가로대-상", wMm: railW, hMm: frameWidthMm });
  pieces.push({ part: "가로대-하", wMm: railW, hMm: frameWidthMm });
  for (let i = 1; i < rows; i++) {
    pieces.push({ part: rows === 2 ? "가로대-중" : `가로대-중${i}`, wMm: railW, hMm: frameWidthMm });
  }

  if (hasPanel) {
    const pw = panelW + JOINT_SEAM_MM * 2; // 사방 프레임 밑으로 겹치도록 둘레에 시접
    const ph = panelH + JOINT_SEAM_MM * 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pieces.push({ part: panelPartLabel(r, c, rows, cols), wMm: pw, hMm: ph });
      }
    }
  }
  return pieces;
}

/** 알판이 여러 칸이면 위치를 알아보기 쉬운 말로 붙인다(좌/우, 상/하, 좌상/우상/좌하/우하). */
function panelPartLabel(r: number, c: number, rows: number, cols: number): string {
  if (rows === 1 && cols === 1) return "알판";
  const rowLabel = rows === 1 ? "" : rows === 2 ? (r === 0 ? "상" : "하") : `${r + 1}행`;
  const colLabel = cols === 1 ? "" : cols === 2 ? (c === 0 ? "좌" : "우") : `${c + 1}열`;
  return `알판-${colLabel}${rowLabel}`;
}

/** 재단 리스트·2D 안내도에서 짧게 붙일 조각 표식 — "기둥-좌"→"좌", "알판-좌상"→"좌상". */
function shortPartLabel(part: string): string {
  const idx = part.indexOf("-");
  return idx === -1 ? part : part.slice(idx + 1);
}

// [샷시/창틀 — 절대 통판으로 계산하지 않는다]
// 샷시는 가운데가 유리로 뚫려 있어, 전체 면적을 통판으로 잡으면 유리 자리만큼 원단을
// 그냥 버리는 셈이다. 그래서 문짝과 달리 "민짜문" 같은 통판 옵션 자체가 없다 — 항상
// 세로 기둥 2장 + 가로대 2장, 얇고 긴 띠장 4피스로만 계산한다. 이는 buildDoorFramePieces의
// rows=1·cols=1·hasPanel=false(유리 자리 = 알판 없음)와 같은 모양이지만, 창틀 모서리는
// (문짝의 짜맞춤과 달리) 45도로 맞물리는 미터 컷이 보통이라 문짝처럼 가로대 끝에 조인트
// 겹침 시접을 따로 더하지 않는다 — 랩핑 깊이(dMm으로 넘기는 창틀 두께)에 이미 사방 마진
// (두께+20mm, 최소 30mm)이 붙으므로 모서리에서도 충분히 겹친다.
function buildSashFramePieces(wMm: number, hMm: number, frameWidthMm: number): DoorFramePieceSpec[] | null {
  if (frameWidthMm <= 0) return null;
  const railSpanW = wMm - frameWidthMm * 2; // 좌우 기둥 사이, 가로대의 실제 길이
  if (railSpanW <= 0) return null;
  return [
    { part: "기둥-좌", wMm: frameWidthMm, hMm: hMm },
    { part: "기둥-우", wMm: frameWidthMm, hMm: hMm },
    { part: "가로대-상", wMm: railSpanW, hMm: frameWidthMm },
    { part: "가로대-하", wMm: railSpanW, hMm: frameWidthMm },
  ];
}

// [문틀(케이싱) — 입체 'ㄷ자' 계산]
// 문틀은 평면 조각이 아니라 앞 문선 + 안쪽 기둥(벽) 두께 + 뒷 문선을 한 번에 감아
// 두르는 'ㄷ자' 단면이다. 그래서 띠장의 폭(Girth, 총 둘레 폭)은 이 셋을 합친 값이고,
// 이 Girth 자체가 이미 "한 조각으로 앞뒤를 다 두른" 치수라 문짝처럼 앞/뒤 조각을 또
// 나누지 않는다 — 양면/단면은 호출하는 쪽에서 Girth에 뒷 문선 폭을 포함시키느냐로
// 미리 반영해서 넘겨준다. 문틀 하나당 세로 기둥 2개 + 상단 가로대 1개, 항상 3피스다.
function buildDoorFrameCasingPieces(wMm: number, hMm: number, girthMm: number): DoorFramePieceSpec[] | null {
  if (wMm <= 0 || hMm <= 0 || girthMm <= 0) return null;
  return [
    { part: "기둥-좌", wMm: girthMm, hMm: hMm },
    { part: "기둥-우", wMm: girthMm, hMm: hMm },
    { part: "가로대-상", wMm: wMm, hMm: girthMm },
  ];
}

/** 문짝류(도안 선택)·문틀(ㄷ자 Girth)·샷시(항상 4피스) 세 갈래를 한 곳에서 분기한다 —
 *  미리보기·추가 로직이 이 함수 하나만 부르면 되므로 나머지 코드는 부위 종류를 몰라도
 *  된다. door 카테고리에서 doorPart가 "frame"이면 문틀로, 도안이 민짜문(rows=0)이 아니면
 *  문짝 도안 분해로, 그 외(민짜문 포함)는 통판 한 장(조각 1개)으로 처리한다. */
function getFramePieceSpecs(
  cat: Category,
  wMm: number,
  hMm: number,
  frameWidthMm: number,
  layout: DoorLayout,
  doorPart: DoorPart,
  girthMm: number
): DoorFramePieceSpec[] | null {
  if (cat === "sash") return buildSashFramePieces(wMm, hMm, frameWidthMm);
  if (cat === "door" && doorPart === "frame") return buildDoorFrameCasingPieces(wMm, hMm, girthMm);
  if (layout.rows > 0) return buildDoorFramePieces(wMm, hMm, frameWidthMm, layout);
  if (wMm <= 0 || hMm <= 0) return null;
  return [{ part: "", wMm, hMm }]; // 민짜문 통판 — 나뉘지 않은 단일 피스(조각 이름 없음)
}

/** 문짝(패널)만 앞/뒤 두 피스로 나눈다 — 문틀은 Girth 계산에 이미 양면이 반영돼 있어
 *  따로 두 배로 만들 필요가 없다(둘 다 두 배로 처리하면 이음매에서 필름이 과하게
 *  겹쳐 두꺼워진다). 뒷면은 앞면이 이미 옆면(두께)까지 감쌌다고 보고 뒷면 자체에는
 *  별도 두께 마진을 더하지 않는다(사방 시접 30mm 기본값만 적용) — "엣지를 감는
 *  마진은 두 피스 중 한 곳에만" 넣으라는 요청을 이렇게 반영했다. */
function applyDoorSided(
  specs: DoorFramePieceSpec[],
  sided: DoorSided,
  dMm: number
): { spec: DoorFramePieceSpec; pieceDMm: number }[] {
  if (sided === "single") return specs.map((spec) => ({ spec, pieceDMm: dMm }));
  return specs.flatMap((spec) => {
    const prefix = spec.part ? `${spec.part}-` : "";
    return [
      { spec: { ...spec, part: `${prefix}앞면` }, pieceDMm: dMm },
      { spec: { ...spec, part: `${prefix}뒷면` }, pieceDMm: 0 },
    ];
  });
}

interface CutGuideLine {
  text: string;
  remnantNote: string;
}

/** 2D 안내도의 줄(선반) 배치를 시공자가 바로 읽고 따라 할 수 있는 문장으로 바꾼다 —
 *  예: "1,220mm 폭에서 문틀/문짝 1개 + 걸레받이/몰딩 1개를 함께 재단하세요". 안내도가
 *  보여주는 것과 정확히 같은 nesting 결과에서 뽑아 쓰므로 그림과 글이 항상 일치한다.
 *  로스 최소화의 핵심은 "이 줄에서 남는 자투리를 다음에 뭘로 채울지"를 알려 주는 것이라,
 *  자투리가 쓸 만큼(50mm 이상) 남으면 문틀·걸레받이 등에 돌려 쓰라고 덧붙인다. */
function buildCutGuide(shelves: NestingShelf[]): CutGuideLine[] {
  return shelves.map((shelf) => {
    const counts = new Map<Category, number>();
    for (const p of shelf.pieces) {
      const cat = p.groupKey as Category;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const parts = [...counts.entries()].map(([cat, n]) => `${categoryOf(cat).label} ${n}개`);
    const verb = parts.length > 1 ? "를 함께 재단하세요" : "를 재단하세요";
    const text = `${ROLL_WIDTH_MM.toLocaleString("ko-KR")}mm 폭에서 ${parts.join(" + ")}${verb}`;
    const remnantMm = Math.max(0, Math.round(ROLL_WIDTH_MM - shelf.usedWidthMm));
    const remnantNote =
      remnantMm >= 50
        ? `자투리 ${remnantMm.toLocaleString("ko-KR")}mm는 버리지 말고 문틀·걸레받이 등 다음 재단에 활용하세요`
        : remnantMm > 0
          ? `자투리 ${remnantMm.toLocaleString("ko-KR")}mm(거의 안 남아요)`
          : "자투리 없이 폭을 꽉 채웠어요";
    return { text, remnantNote };
  });
}

// ---- 음성 명령 인식 ("방문 두 개 추가") -------------------------------------------
// 표준 규격이 있는 부위 이름 + 개수만 알아듣는다. 정확한 치수를 부르는 자유 발화까지
// 받으려면 훨씬 복잡한 파싱이 필요해서, 이번에는 "표준 규격 원터치 추가"의 음성 버전으로
// 범위를 좁혔다 — 표준 규격이 없는 샷시는 음성으로 추가할 수 없고, 화면에도 그렇게 안내한다.
const VOICE_CATEGORY_PATTERNS: [RegExp, Category][] = [
  [/방문|문짝|문틀/, "door"],
  // "장식장"은 "도어"를 포함해 말하는 경우가 많아(예: "장식장 도어") 싱크대 패턴보다 먼저 확인한다.
  [/장식장|진열장/, "decor"],
  [/싱크대|옷장|도어|캐비닛/, "cabinet"],
  [/샷시|창틀|창문/, "sash"],
  [/걸레받이|몰딩/, "molding"],
  [/벽면|벽/, "wall"],
];
/** 마이크를 누르면 보여줄 말투 예시. 표준 규격이 있는 부위는 "부위 + 개수"만 알아듣는다
 *  (위 VOICE_CATEGORY_PATTERNS·KOREAN_COUNT_WORDS 참고). 샷시·벽면처럼 표준 규격이 없는
 *  부위는 예시에서 뺀다 — 말해도 "치수를 직접 입력해 주세요"로 돌아가기 때문이다. */
const VOICE_EXAMPLES = ["방문 두 개 추가", "싱크대 도어 세 개", "걸레받이 한 개"];
const KOREAN_COUNT_WORDS: Record<string, number> = {
  한: 1,
  하나: 1,
  두: 2,
  둘: 2,
  세: 3,
  셋: 3,
  네: 4,
  넷: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};

function parseVoiceCommand(text: string): { category: Category | null; qty: number } {
  let category: Category | null = null;
  for (const [pattern, cat] of VOICE_CATEGORY_PATTERNS) {
    if (pattern.test(text)) {
      category = cat;
      break;
    }
  }
  let qty = 1;
  const digitMatch = text.match(/(\d+)\s*개/);
  if (digitMatch) {
    qty = parseInt(digitMatch[1], 10);
  } else {
    for (const [word, n] of Object.entries(KOREAN_COUNT_WORDS)) {
      if (text.includes(`${word}개`) || text.includes(`${word} 개`)) {
        qty = n;
        break;
      }
    }
  }
  return { category, qty: Math.max(1, Math.min(qty, 20)) };
}

/** 문짝 도안을 글자 없이 한눈에 보여주는 작은 그림 — rows×cols 격자를 그대로 렌더링해서
 *  실제로 몇 칸으로 나뉘는지 직관적으로 보인다. 색은 부모 버튼의 글자색(currentColor)을
 *  그대로 물려받아, 선택됨/안 됨 상태에 따라 따로 칠하지 않아도 자동으로 맞는다. */
function DoorLayoutIcon({ rows, cols, glass = false, small = false }: { rows: number; cols: number; glass?: boolean; small?: boolean }) {
  const sizeClass = small ? "h-8 w-6" : "h-14 w-10";
  if (rows <= 0 || cols <= 0) {
    // 민짜문 — 나뉘지 않은 통판 한 장
    return <div className={`${sizeClass} rounded-[3px] bg-current`} aria-hidden />;
  }
  return (
    <div
      className={`grid ${sizeClass} gap-[3px] rounded-[3px] border-[3px] border-current p-[3px]`}
      style={{ gridTemplateRows: `repeat(${rows}, 1fr)`, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      aria-hidden
    >
      {Array.from({ length: rows * cols }).map((_, i) => (
        <div key={i} className={glass ? "rounded-[1px] border border-current/50 bg-current/10" : "rounded-[1px] bg-current/70"} />
      ))}
    </div>
  );
}

export default function CuttingCalculatorPage() {
  const [category, setCategory] = useState<Category>("sash");
  const config = categoryOf(category);

  const [wMm, setWMm] = useState("");
  const [hMm, setHMm] = useState("");
  const [lengthM, setLengthM] = useState("");
  const [stripWidthMm, setStripWidthMm] = useState(String(config.defaultStripWidthMm ?? 150));
  const [dMm, setDMm] = useState(String(config.defaultThicknessMm));
  // 문짝류(문/싱크대·옷장 도어)에서만 의미 있는 도안 선택 — 민짜문(통판) / 1구 알판 /
  // 2구 상하 알판 / 십자 격자 / 타공문(유리). 민짜문이 아니면 통판 한 장이 아니라
  // 기둥·가로대(·알판) 여러 조각으로 자동으로 쪼개 재단한다.
  const isDoorLikeCategory = DOOR_LIKE_CATEGORIES.includes(category);
  // 샷시/창틀은 가운데가 유리라 도안 선택 없이 항상 테두리 띠장 4개로만 계산한다
  // (문짝처럼 "통판" 옵션 자체가 없다).
  const isSashCategory = category === "sash";
  const [doorLayoutId, setDoorLayoutId] = useState(DOOR_LAYOUTS[0].id);
  const currentLayout = doorLayoutOf(doorLayoutId);
  const [frameWidthMm, setFrameWidthMm] = useState(String(config.defaultFrameWidthMm ?? DEFAULT_FRAME_WIDTH_MM));
  // 문짝류 카테고리를 누르면 "문짝 구조를 골라 주세요" 팝업이 뜬다(직관적인 아이콘 선택).
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);

  // "door" 카테고리에서만 의미 있는 문짝(패널) vs 문틀(케이싱) 구분, 그리고 양면(기본)/
  // 단면 시공 선택. 문짝은 벽에 매달려 양쪽에서 다 보이는 입체물이라 원칙적으로 앞/뒤
  // 둘 다 시공한다.
  const [doorPart, setDoorPart] = useState<DoorPart>("panel");
  const [doorSided, setDoorSided] = useState<DoorSided>("double");
  // 문틀(케이싱) 전용 입력 — 앞 문선 폭 + 기둥(벽) 두께 + 뒤 문선 폭을 합친 게 Girth(총 둘레 폭).
  const [frontCasingMm, setFrontCasingMm] = useState(String(DEFAULT_FRONT_CASING_MM));
  const [jambDepthMm, setJambDepthMm] = useState(String(DEFAULT_JAMB_DEPTH_MM));
  const [backCasingMm, setBackCasingMm] = useState(String(DEFAULT_BACK_CASING_MM));

  // 현장에서 앱을 닫았다 다시 열어도 재단 리스트가 남아 있게 한다. state를 만드는
  // 시점에 곧바로 localStorage 값을 채우면(useState의 지연 초기화), "불러오기"와
  // "저장하기"를 별도 effect로 나눴을 때 생기던 순서 race(마운트 시 저장 effect가
  // 아직 반영 안 된 빈 배열을 읽어 방금 불러온 값을 덮어쓰는 문제)가 아예 없어진다.
  const [items, setItems] = useState<CutItem[]>(() => readStoredCutting().items);
  const [lossPercent, setLossPercent] = useState(() => readStoredCutting().lossPercent ?? String(DEFAULT_LOSS_PERCENT));
  // 시접 등 현장 사정으로 기본 여유분에 더하거나 빼는 보정값. 이 집을 재는 동안은
  // 부위를 바꿔도 유지되고, 다음 방문에도 남아 있게 저장된다.
  const [marginOffsetMm, setMarginOffsetMm] = useState(() => readStoredCutting().marginOffsetMm ?? "0");
  const seqRef = useRef<Record<Category, number>>(initialSeqMap(readStoredCutting().items));
  // [하이드레이션 불일치 방지] 위 지연 초기화들은 "불러오기/저장하기 순서 race"는
  // 없애 주지만, 서버 렌더링(HTML을 처음 만드는 시점, localStorage 접근 불가 →
  // 빈 값/기본값)과 브라우저의 첫 렌더링(이미 localStorage를 읽어 옵셋 등 실제 값)이
  // 서로 다른 문자열을 렌더링하게 만든다 — React가 "서버가 만든 HTML과 다르다"며
  // Hydration 에러를 던진다(예: 저장된 옵셋 +5mm가 있으면 "= 30mm" vs "+5(옵셋) = 30mm").
  // 그래서 마운트가 끝나기 전까지는 항상 서버와 똑같은 로딩 화면만 보여주고, 클라이언트
  // 쪽 useEffect(마운트 후에만 실행되므로 서버 HTML과 비교되지 않는다)가 끝난 뒤에야
  // 실제 데이터가 들어간 화면으로 바꾼다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // 프리셋을 누른 순간 카테고리가 바뀌면, 카테고리 변경 effect가 폼을 초기화하는 것보다
  // 프리셋 값을 나중에 채워야 한다. setState는 비동기라 같은 틱에 둘 다 부르면 순서를
  // 보장할 수 없어서, "이번 카테고리 effect가 끝나면 이 프리셋 값으로 채워라"를 ref에 적어 둔다.
  const pendingPresetRef = useRef<Preset | null>(null);
  // 같은 규격을 여러 개 한 번에 넣을 때 쓰는 수량. 치수를 새로 입력할 때마다 1로 되돌린다.
  const [qty, setQty] = useState(1);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  // ---- 음성 인식 상태 ----
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const SR =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    setVoiceSupported(!!SR);
  }, []);

  // 카테고리를 바꾸면 그 부위의 기본 두께·몰딩 폭으로 다시 채운다. 치수(가로/세로/길이)는
  // 새로 잴 값이므로 비운다 — 단, 프리셋 버튼이 카테고리 전환과 함께 눌린 경우엔
  // pendingPresetRef에 적어 둔 표준 치수로 채운다(빈 값으로 지웠다가 다시 채우는 게 아니라
  // 이 effect 안에서 한 번에 정한다). 여유분은 더 이상 따로 저장하지 않는다 — 두께에서 자동으로 나온다.
  useEffect(() => {
    const pending = pendingPresetRef.current;
    pendingPresetRef.current = null;
    if (config.linear) {
      setLengthM(pending?.lengthM !== undefined ? String(pending.lengthM) : "");
      setStripWidthMm(String(pending?.stripWidthMm ?? config.defaultStripWidthMm ?? 150));
      setWMm("");
      setHMm("");
    } else {
      setWMm(pending?.wMm !== undefined ? String(pending.wMm) : "");
      setHMm(pending?.hMm !== undefined ? String(pending.hMm) : "");
      setLengthM("");
    }
    setDMm(String(config.defaultThicknessMm));
    setQty(1);
    setDoorLayoutId(DOOR_LAYOUTS[0].id);
    setFrameWidthMm(String(config.defaultFrameWidthMm ?? DEFAULT_FRAME_WIDTH_MM));
    setDoorPart("panel");
    setDoorSided("double");
    setFrontCasingMm(String(DEFAULT_FRONT_CASING_MM));
    setJambDepthMm(String(DEFAULT_JAMB_DEPTH_MM));
    setBackCasingMm(String(DEFAULT_BACK_CASING_MM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, lossPercent, marginOffsetMm }));
    } catch {
      /* 저장 실패해도(용량 초과 등) 화면 동작에는 지장이 없다 */
    }
  }, [items, lossPercent, marginOffsetMm]);

  const offset = parseFloat(marginOffsetMm) || 0;

  // 지금 입력창의 값으로 실시간 미리보기 — 리스트에 추가하기 전에도 재단 치수가 바로 보인다.
  const preview = useMemo(() => {
    const d = Math.max(0, parseFloat(dMm) || 0);
    if (config.linear) {
      const len = parseFloat(lengthM) || 0;
      const strip = Math.max(0, parseFloat(stripWidthMm) || 0);
      if (len <= 0 || strip <= 0) return null;
      return computeMolding(len, strip, offset);
    }
    const w = parseFloat(wMm) || 0;
    const h = parseFloat(hMm) || 0;
    if (w <= 0 || h <= 0) return null;
    return computePanel(w, h, d, offset);
  }, [config.linear, wMm, hMm, lengthM, stripWidthMm, dMm, offset]);

  // 문짝(패널)은 도안이 민짜문이 아니거나 양면 시공일 때(통판도 앞/뒤 2피스로 쪼개야
  // 하므로), 문틀(케이싱)은 항상(ㄷ자 Girth 띠장), 샷시는 항상(가운데 유리라 통판
  // 옵션 자체가 없다) — 이럴 때 통판 한 장이 아니라 여러 조각으로 쪼개 재단한다.
  const isDoorFrame = category === "door" && doorPart === "frame";
  const isStripMode =
    isSashCategory ||
    isDoorFrame ||
    (isDoorLikeCategory && currentLayout.rows > 0) ||
    (category === "door" && doorSided === "double");
  // 문짝(패널)만 앞/뒤 2피스로 나눈다 — 문틀은 Girth 계산에 이미 양면이 반영돼 있다.
  const shouldDoubleSided = category === "door" && doorPart === "panel";
  const girthMm = isDoorFrame
    ? Math.max(0, parseFloat(frontCasingMm) || 0) +
      Math.max(0, parseFloat(jambDepthMm) || 0) +
      (doorSided === "double" ? Math.max(0, parseFloat(backCasingMm) || 0) : 0)
    : 0;

  /** 도안·문틀·샷시로 쪼개질 때의 조각별 미리보기 — 통판 한 장이 아니라 여러 조각으로
   *  쪼개지므로, 조각마다 실제 재단 치수를 따로 보여준다. 민짜문(문짝) 또는 전체 면적
   *  통판 대비 원단이 얼마나 다른지도 함께 계산해 왜 이 숫자가 나왔는지 보여준다. */
  const latticePreview = useMemo(() => {
    if (!isStripMode) return null;
    const w = parseFloat(wMm) || 0;
    const h = parseFloat(hMm) || 0;
    // 문틀(케이싱)은 "두께 D" 입력칸 자체가 안 보인다 — 기둥 두께는 이미 girthMm 공식에
    // 명시적으로 들어가 있으므로, 다른 모드에 쓰던 dMm 값이 남아 있어도 여기선 무시한다.
    const d = isDoorFrame ? 0 : Math.max(0, parseFloat(dMm) || 0);
    const frame = Math.max(0, parseFloat(frameWidthMm) || 0);
    if (w <= 0 || h <= 0) return null;
    const rawSpecs = getFramePieceSpecs(category, w, h, frame, currentLayout, doorPart, girthMm);
    if (!rawSpecs) return null;
    const finalSpecs = shouldDoubleSided ? applyDoorSided(rawSpecs, doorSided, d) : rawSpecs.map((spec) => ({ spec, pieceDMm: d }));
    const pieces = finalSpecs.map(({ spec, pieceDMm }) => ({ ...spec, computed: computePanel(spec.wMm, spec.hMm, pieceDMm, offset) }));
    const totalAreaM2 = pieces.reduce((sum, p) => sum + p.computed.areaM2, 0);
    const flatAreaM2 = computePanel(w, h, d, offset).areaM2;
    const extraPercent = flatAreaM2 > 0 ? Math.round(((totalAreaM2 - flatAreaM2) / flatAreaM2) * 100) : 0;
    return { pieces, totalAreaM2, extraPercent };
  }, [isStripMode, category, currentLayout, doorPart, girthMm, shouldDoubleSided, doorSided, wMm, hMm, dMm, frameWidthMm, offset]);

  /** 리스트에 한 항목을 더하는 공용 함수 — 수동 입력, 표준 규격 원터치, 음성 명령이
   *  전부 이 함수 하나로 모인다. cat이 몰딩이면 dims에서 length/strip을, 아니면 w/h를 쓴다. */
  function addItem(cat: Category, dims: { wMm?: number; hMm?: number; lengthM?: number; stripWidthMm?: number }, dOverrideMm?: number) {
    const cfg = categoryOf(cat);
    const d = Math.max(0, dOverrideMm ?? cfg.defaultThicknessMm);
    let computed: { marginMm: number; cutWMm: number; cutHMm: number; areaM2: number } | null = null;
    if (cfg.linear) {
      const len = dims.lengthM ?? 0;
      const strip = dims.stripWidthMm ?? cfg.defaultStripWidthMm ?? 150;
      if (len > 0 && strip > 0) computed = computeMolding(len, strip, offset);
    } else {
      const w = dims.wMm ?? 0;
      const h = dims.hMm ?? 0;
      if (w > 0 && h > 0) computed = computePanel(w, h, d, offset);
    }
    if (!computed) return false;

    seqRef.current[cat] += 1;
    const base = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      category: cat,
      seq: seqRef.current[cat],
      dMm: d,
      marginMm: computed.marginMm,
      marginOffsetMm: offset,
      cutWMm: computed.cutWMm,
      cutHMm: computed.cutHMm,
      areaM2: computed.areaM2,
      checked: false,
    };
    const item: CutItem = cfg.linear
      ? { ...base, lengthM: dims.lengthM, stripWidthMm: dims.stripWidthMm ?? cfg.defaultStripWidthMm }
      : { ...base, wMm: dims.wMm, hMm: dims.hMm };
    setItems((prev) => [...prev, item]);
    if (navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch {
        /* 진동 미지원 기기는 무시 */
      }
    }
    return true;
  }

  /** 문짝(도안 선택·양면 시 앞뒤 2피스)·문틀(ㄷ자 Girth)·샷시(항상 4피스)를 여러 조각으로
   *  쪼개 한 번에 리스트에 넣는다. 같은 짝(seq)에 속한 조각들이라는 걸 알아볼 수 있게
   *  seq는 공유하고 part로 구분한다 — 재단 리스트·2D 안내도·재단 지시서 전부 이 items
   *  배열 하나만 보고 그리므로, 별도 연동 코드 없이도 조각들이 그대로 반영된다. */
  function addFramePieceSet(
    cat: Category,
    wMmVal: number,
    hMmVal: number,
    dOverrideMm: number,
    frameWidthMmVal: number,
    layout: DoorLayout,
    doorPartVal: DoorPart,
    girthVal: number,
    sidedVal: DoorSided
  ) {
    const rawSpecs = getFramePieceSpecs(cat, wMmVal, hMmVal, frameWidthMmVal, layout, doorPartVal, girthVal);
    if (!rawSpecs) return false;
    const d = Math.max(0, dOverrideMm);
    const shouldDouble = cat === "door" && doorPartVal === "panel";
    const finalSpecs = shouldDouble ? applyDoorSided(rawSpecs, sidedVal, d) : rawSpecs.map((spec) => ({ spec, pieceDMm: d }));

    seqRef.current[cat] += 1;
    const seq = seqRef.current[cat];
    const newItems: CutItem[] = finalSpecs.map(({ spec, pieceDMm }) => {
      const computed = computePanel(spec.wMm, spec.hMm, pieceDMm, offset);
      return {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        category: cat,
        seq,
        wMm: spec.wMm,
        hMm: spec.hMm,
        dMm: pieceDMm,
        marginMm: computed.marginMm,
        marginOffsetMm: offset,
        cutWMm: computed.cutWMm,
        cutHMm: computed.cutHMm,
        areaM2: computed.areaM2,
        checked: false,
        part: spec.part,
        // 샷시·문틀은 도안 개념이 없어(항상 같은 구조) 배지를 달지 않는다.
        doorLayout: cat === "door" && doorPartVal === "panel" ? layout.id : undefined,
      };
    });
    setItems((prev) => [...prev, ...newItems]);
    if (navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch {
        /* 진동 미지원 기기는 무시 */
      }
    }
    return true;
  }

  function handleAdd() {
    // 문틀(케이싱)은 "두께 D" 입력칸이 안 보인다 — 기둥 두께는 이미 girthMm 공식에
    // 명시적으로 들어가 있으므로, 다른 모드에 쓰던 dMm 값이 남아 있어도 여기선 무시한다.
    const d = isDoorFrame ? 0 : Math.max(0, parseFloat(dMm) || 0);

    if (isStripMode) {
      if (!latticePreview) return;
      const w = parseFloat(wMm) || 0;
      const h = parseFloat(hMm) || 0;
      const frame = Math.max(0, parseFloat(frameWidthMm) || 0);
      let added = 0;
      for (let i = 0; i < qty; i++)
        if (addFramePieceSet(category, w, h, d, frame, currentLayout, doorPart, girthMm, doorSided)) added += 1;
      if (added > 0) {
        const piecesEach = latticePreview.pieces.length;
        const label = isDoorFrame ? "문틀" : isSashCategory ? "샷시" : currentLayout.label;
        showToast(`${label} ${added}짝(조각 ${added * piecesEach}개) 추가했어요`);
      }
    } else {
      if (!preview) return;
      const dims = config.linear
        ? { lengthM: parseFloat(lengthM) || 0, stripWidthMm: parseFloat(stripWidthMm) || 0 }
        : { wMm: parseFloat(wMm) || 0, hMm: parseFloat(hMm) || 0 };
      let added = 0;
      for (let i = 0; i < qty; i++) if (addItem(category, dims, d)) added += 1;
      if (added > 1) showToast(`${config.label} ${added}개를 한 번에 추가했어요`);
    }

    // 같은 부위를 연달아 재는 경우가 많아 여유분·두께·문짝 구조는 남겨두고 치수·수량만 비운다.
    setWMm("");
    setHMm("");
    setLengthM("");
    setQty(1);
  }

  /** 프리셋 버튼은 곧바로 리스트에 넣지 않고, 입력창에 표준 치수를 채워만 준다 —
   *  현장마다 문틀 폭이 몇 mm씩 다르거나 하는 경우가 많아, 채워진 값을 보고 바로
   *  손으로 고친 뒤 "추가" 버튼을 눌러야 실제 상황에 맞는다. */
  function handlePreset(cat: Category, preset: Preset) {
    const cfg = categoryOf(cat);
    if (cat !== category) {
      // 카테고리를 바꾸면 그 전환을 처리하는 effect가 폼을 다시 채우므로, 여기서 직접
      // setWMm 등을 불러도 그 effect가 뒤이어 덮어써 버린다 — 그래서 effect가 읽을 값을
      // ref에 남겨 두고 카테고리만 바꾼다.
      pendingPresetRef.current = preset;
      setCategory(cat);
    } else if (cfg.linear) {
      setLengthM(preset.lengthM !== undefined ? String(preset.lengthM) : "");
      setStripWidthMm(String(preset.stripWidthMm ?? cfg.defaultStripWidthMm ?? 150));
    } else {
      setWMm(preset.wMm !== undefined ? String(preset.wMm) : "");
      setHMm(preset.hMm !== undefined ? String(preset.hMm) : "");
    }
    showToast(`${cfg.label} · ${preset.label} 표준 치수를 채웠어요 — 필요하면 고친 뒤 추가하세요`);
  }

  function handleVoiceCommand(text: string) {
    setLastHeard(text);
    const { category: cat, qty } = parseVoiceCommand(text);
    if (!cat) {
      showToast(`"${text}" — 부위를 못 알아들었어요. 방문·샷시·싱크대·걸레받이·벽면·장식장 중 말씀해 주세요`);
      return;
    }
    const cfg = categoryOf(cat);
    const preset = cfg.presets[0];
    if (!preset) {
      setCategory(cat);
      showToast(`${cfg.label}은 표준 규격이 없어 음성으로 못 넣어요. 치수를 직접 입력해 주세요`);
      return;
    }
    let added = 0;
    for (let i = 0; i < qty; i++) if (addItem(cat, preset)) added += 1;
    setCategory(cat);
    showToast(`"${text}" → ${cfg.label} ${preset.label} ${added}개 추가했어요`);
  }

  function startVoice() {
    const SR =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!SR) {
      setVoiceSupported(false);
      showToast("이 브라우저는 음성 인식을 지원하지 않아요");
      return;
    }
    const recognition = new SR();
    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) handleVoiceCommand(text);
    };
    recognition.onerror = () => {
      setListening(false);
      showToast("음성을 인식하지 못했어요. 다시 시도해주세요");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  }
  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function toggleChecked(id: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)));
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }
  function clearAll() {
    if (items.length === 0) return;
    if (!window.confirm("재단 리스트를 모두 지울까요?")) return;
    setItems([]);
    seqRef.current = { ...EMPTY_SEQ };
  }

  // ---- 2D 재단 안내도(nesting) — 총 소요 길이도 이 배치 결과를 기준으로 낸다.
  // (예전에는 면적을 단순 합산해 1,220mm로 나눴는데, 그러면 줄마다 남는 자투리 폭이
  // 계산에서 빠져 실제보다 적게 나온다. 실제 배치를 그려야 나오는 정확한 숫자다.) ----
  const nesting = useMemo(() => {
    const pieces: NestingPiece[] = [];
    // 폭이 넓은 창문의 가로대처럼, 조각 자체가 원단 폭(1,220mm)보다 넓으면 애초에 한 번에
    // 잘라낼 수 없다 — packShelves에 그대로 넘기면 "그 줄만 폭을 넘겨서 쓴 것"이 usedWidthMm에
    // 그대로 남아 자투리가 음수가 되고, 그걸 0으로 가려버리면 "꽉 채웠다"고 잘못 보이게 된다.
    // 그래서 이런 조각은 배치 계산에서 아예 빼고 별도로 경고한다.
    const oversizedParts: { label: string; widthMm: number }[] = [];
    for (const it of items) {
      const cfg = categoryOf(it.category);
      // 패널은 cutWMm이 "롤 폭 방향"(가로), cutHMm이 "롤 길이 방향"(세로)이다. 몰딩은
      // 반대다 — cutWMm에 긴 길이가, cutHMm에 띠 폭이 들어 있다(computeMolding 참고).
      // 안내도에서는 폭 방향을 widthMm으로 맞춰야 롤 폭(1,220mm)과 비교가 맞는다.
      const widthMm = cfg.linear ? it.cutHMm : it.cutWMm;
      const heightMm = cfg.linear ? it.cutWMm : it.cutHMm;
      const partSuffix = it.part ? shortPartLabel(it.part) : "";
      const label = `${cfg.shortLabel}${it.seq}${partSuffix}`;
      if (widthMm > ROLL_WIDTH_MM) {
        oversizedParts.push({ label, widthMm });
        continue;
      }
      const dimLabel = `${Math.round(it.cutWMm).toLocaleString("ko-KR")}×${Math.round(it.cutHMm).toLocaleString("ko-KR")}`;
      pieces.push({ id: it.id, label, dimLabel, groupKey: it.category, widthMm, heightMm });
    }
    return { ...packShelves(pieces, ROLL_WIDTH_MM), oversizedParts };
  }, [items]);

  const lossRate = Math.max(0, parseFloat(lossPercent) || 0);
  const finalLengthM = Math.ceil((nesting.totalLengthMm / 1000) * (1 + lossRate / 100) * 10) / 10;
  // 안내도와 같은 nesting 결과에서 그대로 뽑아 쓰는 재단 지시서 — 그림과 글이 어긋날 일이 없다.
  const cutGuide = useMemo(() => buildCutGuide(nesting.shelves), [nesting]);

  const canAdd = isStripMode ? !!latticePreview : !!preview;
  // 스트립 모드 미리보기 헤더에 쓰는 이름·조각 수 — dimensions을 아직 안 넣어
  // latticePreview가 null일 때도 보여줘야 해서, 치수와 무관하게 먼저 계산해 둔다.
  const stripModeLabel = isDoorFrame ? "문틀 ㄷ자 랩핑" : isSashCategory ? "샷시 테두리 띠장" : currentLayout.label;
  const estimatedPieceCount = isDoorFrame
    ? 3
    : isSashCategory
      ? 4
      : pieceCountOf(currentLayout) * (shouldDoubleSided && doorSided === "double" ? 2 : 1);

  // 마운트되기 전(서버 렌더링 + 클라이언트 첫 렌더링)까지는 항상 이 로딩 화면만 보여준다 —
  // 서버와 클라이언트가 똑같은 HTML을 만들어야 하이드레이션 에러가 안 난다. localStorage에
  // 저장된 실제 값(재단 리스트·옵셋 등)은 useEffect가 mounted를 true로 바꾼 다음
  // 순수 클라이언트 렌더링에서만 화면에 나타난다(서버 HTML과 비교되지 않는 단계라 안전).
  if (!mounted) {
    return (
      <main className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[#0b0d12] text-[#f2f4f6]">
        <p className="text-[13px] text-[#6b7480]">불러오는 중…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen min-h-[100dvh] bg-[#0b0d12] text-[#f2f4f6]">
      <div className="mx-auto max-w-[480px] px-4 pb-16 pt-4">
        <header className="mb-5">
          <Link
            href="/"
            className="-ml-2 inline-flex h-11 items-center gap-1 rounded-xl px-2 text-[14px] font-medium text-[#9aa4b2] transition-colors active:bg-white/5"
          >
            <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
            메인으로
          </Link>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-[-0.03em]">스마트 재단 계산기</h1>
          <p className="mt-1.5 text-[15px] text-[#9aa4b2]">
            표준 규격은 원터치로, 특수 치수는 줄자로 재서 입력하면 재단 도면까지 자동으로 나와요
          </p>
        </header>

        {/* 부위 선택 */}
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = c.id === category;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCategory(c.id);
                  // 문짝류 부위를 누르면 곧바로 "문짝 구조를 골라 주세요" 팝업을 띄운다 —
                  // 기공이 굴곡·알판 여부를 스스로 계산하게 두지 않고 그림으로 먼저 고르게 한다.
                  if (DOOR_LIKE_CATEGORIES.includes(c.id)) setShowLayoutPicker(true);
                }}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] py-3 text-[12px] font-bold transition-colors ${
                  active ? "border-indigo-500 bg-indigo-500/10 text-indigo-300" : "border-transparent bg-[#16191f] text-[#9aa4b2]"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
                {c.label}
              </button>
            );
          })}
        </div>

        {/* 표준 규격 원터치 + 음성 명령 */}
        <div className="mt-3 flex items-stretch gap-2">
          {config.presets.length > 0 ? (
            <div className="flex flex-1 flex-wrap gap-2">
              {config.presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => handlePreset(category, p)}
                  className="flex h-12 items-center gap-1.5 rounded-2xl bg-[#16191f] px-4 text-[13px] font-bold text-[#f2f4f6] transition-transform active:scale-[0.97]"
                >
                  <Zap className="h-4 w-4 text-amber-400" strokeWidth={2} />
                  {p.label}
                  <span className="text-[11px] font-medium text-[#6b7480]">
                    {p.wMm ? `${p.wMm}×${p.hMm}` : `${p.lengthM}m×${p.stripWidthMm}`}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="flex flex-1 items-center rounded-2xl bg-[#16191f] px-4 text-[12.5px] text-[#6b7480]">
              이 부위는 표준 규격이 없어요 — 아래에서 직접 입력하세요
            </p>
          )}
          <button
            type="button"
            onClick={listening ? stopVoice : startVoice}
            disabled={!voiceSupported}
            aria-pressed={listening}
            aria-label={listening ? "음성 인식 중지" : "음성으로 추가"}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-all ${
              listening ? "animate-pulse bg-red-500 text-white" : "bg-[#16191f] text-[#f2f4f6]"
            } disabled:opacity-40`}
          >
            <Mic className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        {!voiceSupported && (
          <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11.5px] text-[#6b7480]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />이 브라우저는 음성 인식을 지원하지 않아요(삼성 인터넷 일부 버전 등)
          </p>
        )}
        {/* 마이크를 누르는 순간 "어떻게 말해야 하는지" 예시를 보여준다 — 누르고 나서
            무슨 말을 해야 할지 몰라 머뭇거리다 인식 시간이 끝나버리는 일이 없게. */}
        {listening && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[11.5px] text-[#9aa4b2]">
            <Mic className="h-3.5 w-3.5 shrink-0 animate-pulse text-red-400" />
            이렇게 말해보세요:
            {VOICE_EXAMPLES.map((ex) => (
              <span key={ex} className="rounded-full bg-[#16191f] px-2.5 py-1 font-medium text-[#f2f4f6]">
                &ldquo;{ex}&rdquo;
              </span>
            ))}
          </div>
        )}
        {lastHeard && (
          <p className="mt-1.5 px-1 text-[11.5px] text-[#6b7480]">
            마지막 인식: <span className="text-[#9aa4b2]">&ldquo;{lastHeard}&rdquo;</span>
          </p>
        )}

        {/* 입력 폼 */}
        <section className="mt-3 rounded-[24px] bg-[#16191f] p-5">
          <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-[#9aa4b2]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {config.note}
          </p>

          {/* 문짝(패널) vs 문틀(케이싱) 구분 + 양면/단면 시공 — 문은 벽에 매달려 양쪽에서
              다 보이는 입체물이라 원칙적으로 앞뒤를 다 시공한다(양면이 기본값). 현장에
              따라 한쪽 면만 시공하는 예외도 있어 토글로 바꿀 수 있게 했다. 싱크대/옷장
              도어는 뒷면이 몸체 안쪽에 가려져 이 선택지 자체가 없다(항상 단면과 동일). */}
          {category === "door" && (
            <div className="mt-4 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                {(["panel", "frame"] as DoorPart[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDoorPart(p)}
                    aria-pressed={doorPart === p}
                    className={`h-11 rounded-xl text-[13px] font-bold transition-colors ${
                      doorPart === p ? "bg-indigo-600 text-white" : "bg-[#1a1d23] text-[#9aa4b2]"
                    }`}
                  >
                    {p === "panel" ? "문짝" : "문틀"}
                  </button>
                ))}
              </div>
              <div>
                <span className="text-[13px] font-semibold text-[#9aa4b2]">시공 면</span>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {(["double", "single"] as DoorSided[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDoorSided(s)}
                      aria-pressed={doorSided === s}
                      className={`h-11 rounded-xl text-[13px] font-bold transition-colors ${
                        doorSided === s ? "bg-indigo-600 text-white" : "bg-[#1a1d23] text-[#9aa4b2]"
                      }`}
                    >
                      {s === "double" ? "양면 시공(기본값)" : "단면 시공"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 문짝 도안 — 통판 한 장이 아닌 도안을 고르면 기둥·가로대(·알판)로 자동으로
              쪼개 재단한다(홈 굴곡 + 덧방 시공). 실제 선택은 팝업(아래)에서 그림으로
              고르고, 여기서는 지금 고른 도안을 보여주고 다시 열 수 있는 버튼만 둔다.
              샷시는 도안을 고를 필요가 없다 — 가운데가 항상 유리라 테두리 띠장
              4개(세로 기둥 2 + 가로대 2)로만 계산하므로, 고정된 안내문만 보여준다.
              문틀 모드는 아래에서 전용 입력(전체 W/H + 문선 폭 + 기둥 두께)을 따로
              보여주므로 여기서는 안 보여준다. */}
          {(isDoorLikeCategory || isSashCategory) && !isDoorFrame && (
            <div className="mt-4">
              {isDoorLikeCategory ? (
                <button
                  type="button"
                  onClick={() => setShowLayoutPicker(true)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-[#1a1d23] px-4 py-3"
                >
                  <span className="flex items-center gap-3 text-indigo-300">
                    <DoorLayoutIcon rows={currentLayout.rows} cols={currentLayout.cols} glass={!currentLayout.hasPanel} small />
                    <span className="text-left">
                      <span className="block text-[13.5px] font-bold text-[#f2f4f6]">{currentLayout.label}</span>
                      <span className="block text-[11.5px] text-[#6b7480]">
                        {isStripMode
                          ? `조각 ${pieceCountOf(currentLayout) * (shouldDoubleSided && doorSided === "double" ? 2 : 1)}개로 자동 분해`
                          : "통판 한 장"}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[#262b33] px-3 py-1.5 text-[12px] font-semibold text-indigo-300">
                    변경
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-2xl bg-[#1a1d23] px-4 py-3">
                  <DoorLayoutIcon rows={1} cols={1} glass small />
                  <span>
                    <span className="block text-[13.5px] font-bold text-[#f2f4f6]">테두리 띠장 4개로 자동 분해</span>
                    <span className="block text-[11.5px] text-[#6b7480]">가운데 유리 자리는 재단하지 않아요</span>
                  </span>
                </div>
              )}
              {isStripMode && (
                <label className="mt-3 block">
                  <span className="text-[13px] font-semibold text-[#9aa4b2]">
                    {isSashCategory ? "프레임 정면 폭" : "기둥/가로대 폭"}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={frameWidthMm}
                    onChange={(e) => setFrameWidthMm(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="mm"
                    className="mt-1.5 h-14 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-4 text-center text-[18px] font-extrabold tabular-nums text-[#f2f4f6] outline-none focus:border-indigo-500"
                  />
                </label>
              )}
            </div>
          )}

          {isDoorFrame ? (
            <div className="mt-4 space-y-2.5">
              {/* 문틀 = 앞 문선 + 안쪽 기둥(벽) 두께 + 뒤 문선을 한 번에 감아 두르는
                  'ㄷ자' 단면. 셋을 합친 총 둘레 폭(Girth)이 띠장의 폭이 되고, 문틀 하나당
                  세로 기둥 2개 + 상단 가로대 1개, 항상 3피스로 나온다. */}
              <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[#6b7480]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                문틀은 통판이 아니라 &apos;ㄷ자&apos;로 두르는 띠장이에요 — 앞 문선 + 기둥 두께
                {doorSided === "double" ? " + 뒤 문선" : ""}을 합친 폭으로 세로 기둥 2개 + 상단
                가로대 1개를 냅니다
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className="text-[13px] font-semibold text-[#9aa4b2]">전체 가로 W</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={wMm}
                    onChange={(e) => setWMm(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="mm"
                    className="mt-1.5 h-16 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-2 text-center text-[22px] font-extrabold tabular-nums text-[#f2f4f6] outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-[#4b5563] focus:border-indigo-500"
                  />
                </label>
                <label className="block">
                  <span className="text-[13px] font-semibold text-[#9aa4b2]">전체 세로 H</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={hMm}
                    onChange={(e) => setHMm(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="mm"
                    className="mt-1.5 h-16 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-2 text-center text-[22px] font-extrabold tabular-nums text-[#f2f4f6] outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-[#4b5563] focus:border-indigo-500"
                  />
                </label>
              </div>
              <div className={`grid gap-2.5 ${doorSided === "double" ? "grid-cols-3" : "grid-cols-2"}`}>
                <label className="block">
                  <span className="text-[13px] font-semibold text-[#9aa4b2]">앞 문선 폭</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={frontCasingMm}
                    onChange={(e) => setFrontCasingMm(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="mm"
                    className="mt-1.5 h-14 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-2 text-center text-[18px] font-extrabold tabular-nums text-[#f2f4f6] outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="block">
                  <span className="text-[13px] font-semibold text-[#9aa4b2]">기둥 두께</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={jambDepthMm}
                    onChange={(e) => setJambDepthMm(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="mm"
                    className="mt-1.5 h-14 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-2 text-center text-[18px] font-extrabold tabular-nums text-[#f2f4f6] outline-none focus:border-indigo-500"
                  />
                </label>
                {doorSided === "double" && (
                  <label className="block">
                    <span className="text-[13px] font-semibold text-[#9aa4b2]">뒤 문선 폭</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={backCasingMm}
                      onChange={(e) => setBackCasingMm(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      placeholder="mm"
                      className="mt-1.5 h-14 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-2 text-center text-[18px] font-extrabold tabular-nums text-[#f2f4f6] outline-none focus:border-indigo-500"
                    />
                  </label>
                )}
              </div>
              <p className="text-center text-[12px] tabular-nums text-[#6b7480]">
                총 둘레 폭(Girth) = {girthMm.toLocaleString("ko-KR")}mm
              </p>
            </div>
          ) : config.linear ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[13px] font-semibold text-[#9aa4b2]">길이 (m)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={0}
                  value={lengthM}
                  onChange={(e) => setLengthM(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="0.0"
                  className="mt-1.5 h-16 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-4 text-center text-[24px] font-extrabold tabular-nums text-[#f2f4f6] outline-none placeholder:text-[#4b5563] focus:border-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-semibold text-[#9aa4b2]">폭 (mm)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={stripWidthMm}
                  onChange={(e) => setStripWidthMm(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="mt-1.5 h-16 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-4 text-center text-[24px] font-extrabold tabular-nums text-[#f2f4f6] outline-none focus:border-indigo-500"
                />
              </label>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <label className="block">
                <span className="text-[13px] font-semibold text-[#9aa4b2]">가로 W</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={wMm}
                  onChange={(e) => setWMm(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="mm"
                  className="mt-1.5 h-16 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-2 text-center text-[22px] font-extrabold tabular-nums text-[#f2f4f6] outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-[#4b5563] focus:border-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-semibold text-[#9aa4b2]">세로 H</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={hMm}
                  onChange={(e) => setHMm(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="mm"
                  className="mt-1.5 h-16 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-2 text-center text-[22px] font-extrabold tabular-nums text-[#f2f4f6] outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-[#4b5563] focus:border-indigo-500"
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-semibold text-[#9aa4b2]">
                  {isSashCategory ? "랩핑 깊이(창틀 두께)" : "두께 D"}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={dMm}
                  onChange={(e) => setDMm(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="mm"
                  className="mt-1.5 h-16 w-full rounded-2xl border border-[#262b33] bg-[#1a1d23] px-2 text-center text-[22px] font-extrabold tabular-nums text-[#f2f4f6] outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-[#4b5563] focus:border-indigo-500"
                />
              </label>
            </div>
          )}

          {/* 여유분은 "두께 + 20mm" 규칙으로 자동 계산된다. 현장에 따라 시접을 더 넣어야 하는
              등 그것만으론 모자랄 때는, 옵셋으로 사방에 더하거나(+) 뺄(-) 수 있다. 이 옵셋은
              부위를 바꿔도, 앱을 다시 열어도 유지된다 — 한 현장에서 계속 같은 조건이기 때문. */}
          <div className="mt-3 border-t border-[#262b33] pt-3">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="font-semibold text-[#9aa4b2]">사방 여유분</span>
              <span className="font-bold tabular-nums text-[#f2f4f6]">
                두께+20{offset !== 0 ? ` ${offset > 0 ? "+" : ""}${offset}(옵셋)` : ""} ={" "}
                {Math.max(MARGIN_MIN_MM, (Math.max(0, parseFloat(dMm) || 0) + MARGIN_EXTRA_MM + offset)).toLocaleString("ko-KR")}mm
              </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p className="text-[12px] leading-snug text-[#6b7480]">
                최소 {MARGIN_MIN_MM}mm는 무조건 보장돼요 — 시접 등 여유분을 더 줘야 하면 옵셋을 조정하세요
              </p>
              <span className="flex h-11 shrink-0 items-center rounded-xl bg-[#1a1d23] px-1">
                <button
                  type="button"
                  onClick={() => setMarginOffsetMm(String(offset - MARGIN_OFFSET_STEP_MM))}
                  aria-label="여유분 옵셋 줄이기"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9aa4b2] active:bg-[#262b33]"
                >
                  <Minus className="h-4 w-4" strokeWidth={2} />
                </button>
                <span className="min-w-[3.2rem] text-center text-[14px] font-extrabold tabular-nums text-[#f2f4f6]">
                  {offset > 0 ? "+" : ""}
                  {offset}mm
                </span>
                <button
                  type="button"
                  onClick={() => setMarginOffsetMm(String(offset + MARGIN_OFFSET_STEP_MM))}
                  aria-label="여유분 옵셋 늘리기"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-indigo-400 active:bg-[#262b33]"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                </button>
              </span>
            </div>
          </div>

          {/* 실시간 미리보기 — 리스트에 넣기 전에도 재단 치수가 바로 보인다.
              문짝 도안·샷시는 통판 한 장이 아니라 조각마다 따로 보여준다. */}
          {isStripMode ? (
            <div className="mt-4 rounded-2xl bg-[#1a1d23] px-4 py-3.5">
              <p className="text-center text-[12px] font-bold text-[#6b7480]">
                {stripModeLabel} — 결 방향 고정, 조각{" "}
                {latticePreview ? latticePreview.pieces.length : estimatedPieceCount}개로 자동 분해
              </p>
              {latticePreview ? (
                <>
                  <ul className="mt-2.5 space-y-1.5">
                    {latticePreview.pieces.map((p) => (
                      <li key={p.part} className="flex items-center justify-between text-[13px]">
                        <span className="text-[#9aa4b2]">{p.part}</span>
                        <span className="font-bold tabular-nums text-[#f2f4f6]">
                          {Math.round(p.computed.cutWMm).toLocaleString("ko-KR")} × {Math.round(p.computed.cutHMm).toLocaleString("ko-KR")}mm
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 border-t border-[#262b33] pt-2 text-center text-[12px] tabular-nums text-[#6b7480]">
                    합계 약 {won2(latticePreview.totalAreaM2)}㎡
                    {latticePreview.extraPercent !== 0 && (
                      <span className={latticePreview.extraPercent > 0 ? "text-amber-400" : "text-emerald-400"}>
                        {" "}
                        · 통판 대비 {latticePreview.extraPercent > 0 ? "+" : ""}
                        {latticePreview.extraPercent}%
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-center text-[15px] font-semibold text-[#4b5563]">
                  치수와 프레임 폭을 입력해 주세요(프레임 폭이 전체 치수의 절반보다 작아야 해요)
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl bg-[#1a1d23] px-4 py-3.5 text-center">
              <p className="text-[12px] font-bold text-[#6b7480]">
                실제 재단 치수 <span className="font-normal">(가로 {CUT_STEP_W_MM}mm · 세로 {CUT_STEP_H_MM}mm 단위 올림)</span>
              </p>
              {preview ? (
                <p className="mt-0.5 text-[22px] font-extrabold tabular-nums tracking-[-0.02em]">
                  {Math.round(preview.cutWMm).toLocaleString("ko-KR")} × {Math.round(preview.cutHMm).toLocaleString("ko-KR")}
                  <span className="ml-1 text-[14px] font-bold text-[#6b7480]">mm</span>
                </p>
              ) : (
                <p className="mt-0.5 text-[15px] font-semibold text-[#4b5563]">치수를 입력해 주세요</p>
              )}
              {preview && <p className="mt-0.5 text-[12px] tabular-nums text-[#6b7480]">약 {won2(preview.areaM2)}㎡</p>}
            </div>
          )}

          {/* 동일 규격을 여러 개 한 번에 넣을 때 쓰는 수량 스테퍼 */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-[#9aa4b2]">수량</span>
            <span className="flex h-11 items-center rounded-xl bg-[#1a1d23] px-1">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(QTY_MIN, q - 1))}
                disabled={qty <= QTY_MIN}
                aria-label="수량 줄이기"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9aa4b2] active:bg-[#262b33] disabled:opacity-30"
              >
                <Minus className="h-4 w-4" strokeWidth={2} />
              </button>
              <span className="min-w-[3.2rem] text-center text-[16px] font-extrabold tabular-nums text-[#f2f4f6]">{qty}개</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(QTY_MAX, q + 1))}
                disabled={qty >= QTY_MAX}
                aria-label="수량 늘리기"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-indigo-400 active:bg-[#262b33] disabled:opacity-30"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
              </button>
            </span>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="mt-3 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-[18px] font-extrabold text-white transition-transform active:scale-[0.98] disabled:bg-[#262b33] disabled:text-[#4b5563]"
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
            재단 리스트에 추가
            {isStripMode && latticePreview
              ? ` (조각 ${qty * latticePreview.pieces.length}개)`
              : qty > 1
                ? ` (${qty}개)`
                : ""}
          </button>
        </section>

        {/* 원단 폭(1,220mm)보다 넓은 조각 경고 — 폭이 넓은 창문의 가로대 등, 실제로
            한 번에 잘라낼 수 없는 조각이 리스트에 섞여 있으면 안내도·지시서에서 조용히
            숨기지 않고 여기서 먼저 알린다(이어 붙이거나 나눠서 재입력해야 한다). */}
        {nesting.oversizedParts.length > 0 && (
          <section className="mt-6 rounded-[24px] border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="flex items-start gap-1.5 text-[13px] font-bold text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              원단 폭보다 넓은 조각이 있어요
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-amber-200/80">
              아래 조각은 폭이 {ROLL_WIDTH_MM.toLocaleString("ko-KR")}mm 원단보다 넓어 한 번에 재단할 수 없어요 —
              이어 붙여(스플라이스) 시공하거나, 프레임 폭을 넓혀 다시 입력해 주세요. 안내도·재단
              지시서 계산에서는 일단 뺐어요.
            </p>
            <ul className="mt-2.5 space-y-1">
              {nesting.oversizedParts.map((p) => (
                <li key={p.label} className="flex items-center justify-between text-[12.5px] tabular-nums text-amber-100">
                  <span>{p.label}</span>
                  <span className="font-bold">{Math.round(p.widthMm).toLocaleString("ko-KR")}mm</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 재단 리스트 */}
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[15px] font-bold">재단 리스트 · {items.length}개</h2>
            {items.length > 0 && (
              <button type="button" onClick={clearAll} className="text-[13px] font-medium text-[#6b7480]">
                전체 삭제
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[#262b33] bg-[#16191f]/60 py-10 text-center text-[13px] text-[#6b7480]">
              아직 추가된 재단 항목이 없어요
            </div>
          ) : (
            <ul className="divide-y divide-[#262b33] rounded-[24px] bg-[#16191f] px-1">
              {items.map((it) => {
                const cfg = categoryOf(it.category);
                const dimsLabel = cfg.linear
                  ? `${won2(it.lengthM ?? 0, 1)}m 길이 × ${it.stripWidthMm}mm 폭`
                  : `${it.wMm} × ${it.hMm}mm`;
                return (
                  <li key={it.id} className="flex items-center gap-3 px-3 py-3">
                    <button
                      type="button"
                      onClick={() => toggleChecked(it.id)}
                      aria-pressed={it.checked}
                      aria-label={it.checked ? "재단 완료 취소" : "재단 완료로 표시"}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                        it.checked ? "bg-indigo-600 text-white" : "bg-[#1a1d23] text-[#4b5563]"
                      }`}
                    >
                      {it.checked ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                    </button>

                    <div className={`min-w-0 flex-1 ${it.checked ? "opacity-40" : ""}`}>
                      <p className={`text-[14.5px] font-bold ${it.checked ? "line-through" : ""}`}>
                        {cfg.label} {it.seq}
                        {it.part && <span className="text-[#6b7480]"> · {it.part}</span>}
                        <span
                          className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle"
                          style={{ backgroundColor: cfg.mapColor }}
                          aria-hidden
                        />
                      </p>
                      <p className={`mt-0.5 text-[12.5px] tabular-nums text-[#6b7480] ${it.checked ? "line-through" : ""}`}>
                        {dimsLabel} → {Math.round(it.cutWMm)} × {Math.round(it.cutHMm)}mm 재단
                        {it.marginOffsetMm !== 0 && (
                          <span className="text-indigo-400"> · 옵셋 {it.marginOffsetMm > 0 ? "+" : ""}{it.marginOffsetMm}mm</span>
                        )}
                        {it.doorLayout && it.doorLayout !== "flat" && (
                          <span className="text-amber-400"> · {doorLayoutOf(it.doorLayout).label}</span>
                        )}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      aria-label="목록에서 지우기"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#4b5563] active:bg-[#1a1d23]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 2D 재단 안내도 */}
        {items.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[15px] font-bold">2D 재단 안내도</h2>
            <p className="mb-2 px-1 text-[12px] leading-relaxed text-[#6b7480]">
              폭 {ROLL_WIDTH_MM.toLocaleString("ko-KR")}mm 원단에 조각을 줄 세워 배치한 안내도예요(돌려서 끼워 맞추지는
              않아요 — 무늬 결이 어긋나지 않도록). 빗금 친 부분이 그 줄에서 버려지는 자투리입니다.
            </p>
            <CutMapView result={nesting} rollWidthMm={ROLL_WIDTH_MM} colorOf={(key) => categoryOf(key as Category).mapColor} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1">
              {CATEGORIES.filter((c) => items.some((it) => it.category === c.id)).map((c) => (
                <span key={c.id} className="flex items-center gap-1.5 text-[12px] text-[#9aa4b2]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.mapColor }} aria-hidden />
                  {c.shortLabel} = {c.label}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* 총 필요 원단 길이 — 위 안내도의 실제 배치를 기준으로 낸 숫자다(면적 어림값이 아니다). */}
        {items.length > 0 && (
          <section className="mt-6 rounded-[24px] bg-indigo-600 p-6 text-white">
            <p className="text-[14px] font-semibold text-indigo-100">총 필요 원단 길이</p>
            <p className="mt-1 text-[44px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
              {won2(finalLengthM, 1)}
              <span className="ml-1 text-[22px] font-bold">M</span>
            </p>
            <p className="mt-3 border-t border-white/20 pt-3 text-[13px] leading-relaxed text-indigo-100">
              재단 안내도 배치 기준 {won2(nesting.totalLengthMm / 1000, 2)}m · 원단 활용률 {won2(nesting.utilizationPercent, 0)}% ·
              표준 폭 {ROLL_WIDTH_MM.toLocaleString("ko-KR")}mm
            </p>
            <label className="mt-3 flex items-center justify-between gap-3 text-[13px] text-indigo-100">
              여유 구매율(파손·재작업 대비)
              <span className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={lossPercent}
                  onChange={(e) => setLossPercent(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="h-10 w-16 rounded-lg border border-white/30 bg-white/10 text-center text-[15px] font-bold tabular-nums text-white outline-none placeholder:text-white/50 focus:border-white/70"
                />
                %
              </span>
            </label>
            {/* 물량 폭증 방지 안내 — 양면 시공이 반영되면 전보다 길이가 확 늘어 보일 수
                있어, 놀라지 않게 왜 늘었는지 작게 짚어 준다. */}
            {items.some((it) => it.category === "door") && (
              <p className="mt-3 text-center text-[11.5px] leading-relaxed text-indigo-200/80">
                문짝 앞/뒤 양면 시공 및 문틀 ㄷ자 랩핑이 반영된 안전 물량입니다
              </p>
            )}
          </section>
        )}

        {/* 재단 지시서(가이드) — 총 길이 숫자만 보여주면 결국 시공자가 안내도를 보고 다시
            직접 판단해야 한다. 줄마다 "뭘 같이 자를지"를 말로 풀어 줘야 바로 손이 간다. */}
        {cutGuide.length > 0 && (
          <section className="mt-4 rounded-[24px] bg-[#16191f] p-5">
            <h2 className="flex items-center gap-1.5 text-[15px] font-bold">
              <Ruler className="h-4 w-4 text-indigo-400" strokeWidth={2} />
              재단 지시서(가이드)
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#6b7480]">
              위 안내도의 줄 순서 그대로예요 — 이 순서대로 원단을 풀어 자르면 자투리를 낭비하지 않아요
            </p>
            <ol className="mt-3 space-y-2.5">
              {cutGuide.map((line, i) => (
                <li key={i} className="flex gap-3 rounded-2xl bg-[#1a1d23] px-4 py-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[12px] font-extrabold tabular-nums text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-bold leading-snug text-[#f2f4f6]">{line.text}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-[#6b7480]">{line.remnantNote}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-8 left-1/2 z-[90] max-w-[88vw] -translate-x-1/2 whitespace-normal rounded-2xl bg-[#f2f4f6] px-5 py-3 text-center text-[14px] font-semibold leading-snug text-[#0b0d12] shadow-lg"
        >
          {toast}
        </div>
      )}

      {/* 문짝 도안 선택 팝업 — 기공이 굴곡·조인트 개수를 직접 계산하게 두지 않고, 그림으로
          형태만 고르면 나머지(몇 조각을 어떻게 잘라야 하는지)는 전부 앱이 계산한다. */}
      {showLayoutPicker && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-black/60"
          onClick={() => setShowLayoutPicker(false)}
        >
          <div
            className="w-full max-w-[480px] rounded-t-[28px] bg-[#16191f] p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#262b33]" />
            <h2 className="text-[17px] font-extrabold">문짝 구조를 선택하세요</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[#9aa4b2]">
              형태만 고르면 기둥·가로대·알판 조각과 치수를 자동으로 쪼개 드려요
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {DOOR_LAYOUTS.map((layout) => {
                const active = layout.id === doorLayoutId;
                return (
                  <button
                    key={layout.id}
                    type="button"
                    onClick={() => {
                      setDoorLayoutId(layout.id);
                      setShowLayoutPicker(false);
                    }}
                    aria-pressed={active}
                    className={`flex flex-col items-center gap-2 rounded-2xl py-4 transition-colors ${
                      active ? "bg-indigo-600 text-white" : "bg-[#1a1d23] text-[#9aa4b2]"
                    }`}
                  >
                    <DoorLayoutIcon rows={layout.rows} cols={layout.cols} glass={!layout.hasPanel} />
                    <span className="text-center text-[12px] font-bold leading-tight">{layout.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Web Speech API는 표준 TS lib에 타입이 없어(브라우저별 구현이라 미표준) 최소한만 직접 선언한다.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: SpeechRecognitionResultLike[];
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
