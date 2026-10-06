"use client";

import type { JobOptionsState, WorkItemId } from "@/types";
import BottomSheet from "@/components/ui/BottomSheet";
import FilmForm from "@/components/forms/FilmForm";
import DoorFrameForm from "@/components/forms/DoorFrameForm";
import MeshScreenForm from "@/components/forms/MeshScreenForm";
import WallFilmForm from "@/components/forms/WallFilmForm";
import WardrobeForm from "@/components/forms/WardrobeForm";
import ToiletForm from "@/components/forms/ToiletForm";
import SashForm from "@/components/forms/SashForm";
import GlassForm from "@/components/forms/GlassForm";
import LightingForm from "@/components/forms/LightingForm";
import FanForm from "@/components/forms/FanForm";
import SinkForm from "@/components/forms/SinkForm";
import IllustrationForm from "@/components/forms/IllustrationForm";
import { WORK_ITEM_META } from "@/lib/workItems";

interface Props {
  item: WorkItemId | null;
  options: JobOptionsState;
  onChange: (options: JobOptionsState) => void;
  onClose: () => void;
}

/** 항목 카드를 누르면 올라오는 상세 옵션 시트. 아코디언처럼 페이지를 밀어내지 않고
 *  한 항목에만 집중하게 해준다. */
export default function ItemOptionsSheet({ item, options, onChange, onClose }: Props) {
  const meta = item ? WORK_ITEM_META[item] : null;

  return (
    <BottomSheet
      open={item !== null}
      onClose={onClose}
      title={meta?.label ?? ""}
      description={meta?.description}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="h-14 w-full rounded-full bg-indigo-600 text-[15px] font-semibold text-white shadow-[0_10px_40px_rgba(79,70,229,0.45)] transition-transform active:scale-[0.98]"
        >
          입력 완료
        </button>
      }
    >
      {item === "film" && (
        <FilmForm value={options.film} onChange={(film) => onChange({ ...options, film })} />
      )}
      {item === "sash" && (
        <SashForm value={options.sash} onChange={(sash) => onChange({ ...options, sash })} />
      )}
      {item === "door_frame" && (
        <DoorFrameForm
          value={options.door_frame}
          onChange={(door_frame) => onChange({ ...options, door_frame })}
        />
      )}
      {item === "wall_film" && (
        <WallFilmForm value={options.wall_film} onChange={(wall_film) => onChange({ ...options, wall_film })} />
      )}
      {item === "wardrobe" && (
        <WardrobeForm value={options.wardrobe} onChange={(wardrobe) => onChange({ ...options, wardrobe })} />
      )}
      {item === "mesh_screen" && (
        <MeshScreenForm
          value={options.mesh_screen}
          onChange={(mesh_screen) => onChange({ ...options, mesh_screen })}
        />
      )}
      {item === "toilet" && (
        <ToiletForm value={options.toilet} onChange={(toilet) => onChange({ ...options, toilet })} />
      )}
      {item === "glass" && (
        <GlassForm value={options.glass} onChange={(glass) => onChange({ ...options, glass })} />
      )}
      {item === "lighting" && (
        <LightingForm value={options.lighting} onChange={(lighting) => onChange({ ...options, lighting })} />
      )}
      {item === "fan" && <FanForm value={options.fan} onChange={(fan) => onChange({ ...options, fan })} />}
      {item === "sink" && <SinkForm value={options.sink} onChange={(sink) => onChange({ ...options, sink })} />}
      {item === "illustration" && (
        <IllustrationForm
          value={options.illustration}
          onChange={(illustration) => onChange({ ...options, illustration })}
        />
      )}
    </BottomSheet>
  );
}
