import {
  AppWindow,
  Blinds,
  CookingPot,
  DoorClosed,
  DoorOpen,
  Droplets,
  Fan,
  Layers,
  LayoutGrid,
  Lightbulb,
  PanelTop,
  Ruler,
  Sparkles,
  Toilet,
  type LucideIcon,
} from "lucide-react";

/** 품목 코드 → 그려 넣은 아이콘. 이모지는 기기마다 모양이 달라 쓰지 않는다. */
const BY_CODE: Record<string, LucideIcon> = {
  DOOR_FLAT: DoorClosed,
  DOOR_CURVED: DoorClosed,
  ENTRANCE: DoorClosed,
  MIDDLE_DOOR: DoorOpen,
  SASH_SMALL: AppWindow,
  SASH_LARGE: AppWindow,
  SINK_L: CookingPot,
  MOLDING_FLAT: Ruler,
  MOLDING_CROWN: Ruler,
  FAN_INSTALL: Fan,
  DOWNLIGHT_NEW: Lightbulb,
  SINK_BOWL_STD: Droplets,
  SINK_BOWL_PREMIUM: Droplets,
  TOILET_STD: Toilet,
  TOILET_ONE_PIECE: Toilet,
  TOILET_BIDET: Toilet,
};

/** 메인 앱 견적(WorkItemId)용. */
const BY_WORK_ITEM: Record<string, LucideIcon> = {
  film: DoorClosed,
  sash: AppWindow,
  glass: PanelTop,
  lighting: Lightbulb,
  fan: Fan,
  sink: Droplets,
  door_frame: DoorClosed,
  mesh_screen: Blinds,
  toilet: Toilet,
  wardrobe: LayoutGrid,
  wall_film: Layers,
};

export type Tone = "indigo" | "amber" | "teal" | "sky";

const TONE_CLASS: Record<Tone, string> = {
  indigo: "bg-indigo-50 text-indigo-600",
  amber: "bg-amber-50 text-amber-700",
  teal: "bg-teal-50 text-teal-700",
  sky: "bg-sky-50 text-sky-700",
};

export function toneOfGroup(group: string): Tone {
  if (group.includes("조명")) return "amber";
  if (group.includes("설비")) return "teal";
  return "indigo";
}

export function toneOfWorkItem(id: string): Tone {
  if (id === "lighting" || id === "fan") return "amber";
  if (id === "sink" || id === "toilet") return "teal";
  if (id === "glass" || id === "mesh_screen") return "sky";
  return "indigo";
}

export default function QuoteIcon({
  code,
  workItem,
  tone,
  size = 40,
}: {
  code?: string;
  workItem?: string;
  tone: Tone;
  size?: number;
}) {
  const Icon = (code && BY_CODE[code]) || (workItem && BY_WORK_ITEM[workItem]) || Sparkles;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center ${TONE_CLASS[tone]}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.32) }}
    >
      <Icon strokeWidth={1.75} style={{ width: size * 0.52, height: size * 0.52 }} />
    </span>
  );
}
