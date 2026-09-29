import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from app.catalog import (
    DRAIN_TYPES,
    FAN_BLADE_COLOR_PROMPTS,
    FAUCET_TYPES,
    FIXTURE_PRODUCTS,
    GLASS_TINT_TYPES,
    PATTERNS,
    SINK_BOWL_SPECS,
)
from app.jobs_store import JOBS
from app.quotes_store import save_quote
from app.schemas import JobOptions
from app.services.estimator import calculate_estimate
from app.services.inpainting import inpaint_region
from app.services.rendering import (
    build_dark_object_mask,
    build_fixture_mask,
    ceiling_placement,
    combine_masks,
    composite_fixtures,
    detect_ceiling_mask,
    detect_existing_lights,
    draw_downlights,
    erase_ceiling_light,
    is_plausible_ceiling,
    recolor_surface,
    tint_fixture_png,
)
from app.services.scene_render import render_scene
from app.services.ai_service import render_region
from app.services.segmentation import segment_surfaces
from app.services.vision_client import analyze_room


# 초기 렌더링에서 선택한 색을 자동 적용할 인식 부위 최대 개수.
# 색 변경은 이제 디퓨전이 아니라 결정적 리컬러라 마스크가 넓어도 공간이
# 망가지지 않으므로, 클릭 가능한 부위 수(MAX_CLICKABLE_REGIONS)와 맞춰
# 인식된 문짝/장을 최대한 다 시공된 모습으로 보여준다.
MAX_AUTO_FILM_REGIONS = 24

# 실링팬이 사진에서 차지하는 가로 비율 — 인페인팅 마스크 크기의 기준이 된다.
# 너무 작으면 디퓨전이 날개 형태를 못 만들고 뿌옇게 뭉개진다.
FAN_SCALE = 0.30
# 다운라이트 반경(사진 가로 대비)과, 천장 기준 행보다 얼마나 앞쪽(아래)에 달지.
DOWNLIGHT_RADIUS_RATIO = 0.014
DOWNLIGHT_ROW_FACTOR = 1.15


def _to_static_url(storage_path: str) -> str:
    return "/" + storage_path.replace("storage/", "static/", 1)


def _stage(job_id: str, text: str) -> None:
    """지금 어느 단계를 처리 중인지 job에 적어 둔다.

    화면에 "무엇을 하는 중"인지 보여주기 위한 것이기도 하지만, 더 중요한 목적은
    프론트엔드의 실패 판정 기준을 바꾸는 것이다. 예전에는 제출 후 총 경과 시간이
    120초를 넘으면 실패로 단정했는데, 부위가 많은 주방 사진은 정상적으로 121초가
    걸려서 다 끝난 작업을 "영역 인식 실패"로 띄웠다. 이 값이 바뀌는 것을 "서버가
    살아서 진행 중"이라는 신호로 쓰면, 오래 걸리는 현장과 진짜로 멈춘 작업을
    구분할 수 있다."""
    JOBS[job_id]["stage"] = text


def _quote_snapshot(job_id: str) -> dict:
    """JOBS의 현재 상태를 JobStatusResponse와 동일한 필드 구조로 스냅샷한다
    (견적서 저장/불러오기, "뒤로가기" 후 복원에 그대로 재사용하기 위함).

    응답 스키마에 없는 내부 필드(regions_internal/current_image_path)도 함께
    저장한다 — 이게 없으면 서버가 재시작된 뒤(--reload 포함) 견적서를 다시 열어
    색상 스와치를 눌렀을 때 "Job not found"가 뜬다. JobStatusResponse는 정의되지
    않은 키를 무시하므로 응답에는 영향이 없다."""
    job = JOBS[job_id]
    return {
        "regions_internal": job.get("regions_internal", {}),
        "current_image_path": job.get("current_image_path"),
        "job_id": job_id,
        "status": job["status"],
        "rendered_image_url": job.get("rendered_image_url"),
        "original_image_url": job.get("original_image_url"),
        "mask_preview_url": job.get("mask_preview_url"),
        "regions": job.get("regions", []),
        "estimate": job.get("estimate"),
        "error": job.get("error"),
        "editing": False,
        "editing_region_id": None,
        "edit_error": None,
        "customer_name": job.get("customer_name", ""),
        "created_at": job.get("created_at"),
    }


def run_pipeline(
    job_id: str,
    image_path: str,
    selected_items: list[str],
    options: JobOptions,
    customer_name: str = "",
    illustration_text: str = "",
    illustration_description: str = "",
    render_mode: str = "auto",
    auto_description: str = "",
    manual_regions: list[dict] | None = None,
) -> None:
    JOBS[job_id]["status"] = "processing"
    _stage(job_id, "현장 사진 준비 중")
    try:
        # 조명/실링팬은 천장 마스크를 원근 스케일링 기준으로 쓰므로, 항목이
        # 선택되어 있으면(개수 무관하게) 세그멘테이션이 필요하다.
        needs_ceiling_ref = bool(
            ("lighting" in selected_items and options.lighting)
            or ("fan" in selected_items and options.fan)
        )
        # 결과 사진에서 클릭해 색을 바꿀 개별 부위(region) 후보는 어떤 항목을 골랐든
        # 항상 뽑는다 — 실링팬만 선택한 경우에도 완성된 팬을 클릭해 색을 바꿀 수
        # 있어야 하기 때문이다 (예전에는 film/sink일 때만 뽑아서, 실링팬만 고르면
        # 클릭할 수 있는 부위가 하나도 없었다).
        needs_regions = bool(selected_items)
        needs_segmentation = needs_ceiling_ref or needs_regions
        # 견적서에 표시할 "AI 인식 천장 면적"은 벽 시공과 무관하게 필름이 선택되면
        # 항상 계산한다. (예전엔 "벽면 시공 포함" 토글을 켰을 때만 이 실측 호출이
        # 돌아 천장 면적도 같이 나왔는데, 벽 시공 기능 자체를 없앤 지금은 그 토글에
        # 얹혀갈 수 없으므로 film 선택 여부로 직접 트리거한다.)
        needs_room_measurement = bool("film" in selected_items and options.film)

        current_path = image_path
        mask_preview_url = None
        ceiling_mask_path = None
        regions = []
        regions_internal = {}

        # 1순위: Gemini 이미지 편집 모델로 "시공 후" 사진을 한 번에 생성한다.
        # 부위별 리컬러 + 마스크 인페인팅을 조합하던 기존 방식은 색은 정확했지만
        # 바닥/상판/타일/조명이 그대로 남아 "원본에 색만 덧칠한" 느낌이었다
        # (services/scene_render.py 주석 참고). 실패하면 아래 기존 파이프라인이
        # 그대로 이어서 동작한다.
        #
        # 실측(analyze_room)은 이 호출과 서로 참조하지 않으므로 동시에 돌려
        # 전체 대기 시간을 둘 중 더 오래 걸리는 쪽 수준으로 줄인다.
        default_room_info = {"ceiling_width_m": 0.0, "ceiling_length_m": 0.0}
        room_info = default_room_info
        scene_instructions = _build_scene_instructions(
            selected_items, options, illustration_text, illustration_description
        )
        # 자동 모드에서 사장님이 말로 적어준 요구사항을 지시문 맨 뒤에 얹는다
        # (수동 모드는 영역별로 따로 렌더링하므로 이 경로를 쓰지 않는다).
        if render_mode == "auto" and auto_description.strip():
            scene_instructions.append(
                "Follow this instruction from the installer as the top priority: "
                f"{auto_description.strip()}"
            )
        scene_rendered = False

        with ThreadPoolExecutor(max_workers=2) as executor:
            room_future = executor.submit(analyze_room, image_path) if needs_room_measurement else None
            if manual_regions:
                # 수동 모드: 사용자가 칠한 영역만 하나씩, taskType에 맞는 방식으로
                # 렌더링한다. 장면 전체를 새로 생성(render_scene)하면 사용자가
                # 지정하지 않은 곳까지 바뀌어 "여기만 바꿔달라"는 요청과 어긋난다.
                current_path = _render_manual_regions(job_id, current_path, manual_regions)
                scene_rendered = current_path != image_path
            elif scene_instructions:
                _stage(job_id, "시공 후 사진 생성 중")
                try:
                    scene_path = f"storage/results/{job_id}_scene.png"
                    with open(scene_path, "wb") as f:
                        f.write(render_scene(current_path, scene_instructions))
                    current_path = scene_path
                    scene_rendered = True
                except Exception as exc:
                    print(f"[pipeline] Gemini 장면 생성 실패, 기존 부분 수정 방식으로 폴백: {exc}")
            if room_future is not None:
                room_info = room_future.result()

        # 세그멘테이션은 반드시 "화면에 실제로 보이게 될 사진"을 대상으로 돌린다.
        # 클릭해서 색을 바꾸는 기능은 마스크 좌표가 표시 중인 이미지와 1:1로 맞아야
        # 하는데, Gemini가 새로 생성한 장면은 원본과 픽셀이 다르므로 원본에서 뽑은
        # 마스크를 그대로 쓰면 클릭 위치가 어긋난다.
        masks: dict | None = None
        if manual_regions:
            # 수동 모드에서는 사용자가 사진 위에 직접 칠해준 영역이 곧 정답이다.
            # AI 자동 분할(SAM)을 돌릴 이유가 없고, 돌리면 오히려 사용자가 지정한
            # 자리를 덮어써 버린다.
            masks = _regions_from_manual(manual_regions)
        elif needs_segmentation:
            _stage(job_id, "영역 인식 중")
            masks = segment_surfaces(current_path, job_id, selected_items, needs_ceiling_ref)

        if masks is not None:
            ceiling_mask_path = masks.get("ceiling_mask_path")
            mask_preview_url = _to_static_url(ceiling_mask_path) if ceiling_mask_path else None
            regions = [
                {
                    "id": r["id"],
                    "label": r["label"],
                    "category": r["category"],
                    "bbox": list(r["bbox"]),
                    "mask_url": _to_static_url(r["mask_path"]),
                }
                for r in masks.get("regions", [])
            ]
            # 프론트엔드에는 URL만 노출하고, 인페인팅 호출에 필요한 로컬 마스크 경로는
            # job 내부 상태로만 보관한다 (JobStatusResponse 스키마에는 없는 필드).
            regions_internal = {
                r["id"]: {
                    "mask_path": r["mask_path"],
                    "label": r["label"],
                    "category": r["category"],
                    "is_panel": r.get("is_panel", True),
                }
                for r in masks.get("regions", [])
            }

        if not scene_rendered and "film" in selected_items and options.film:
            pattern_meta = PATTERNS.get(options.film.pattern_id, PATTERNS["matte-white"])
            # 필름 시공 대상 = AI가 인식한 개별 부위(문짝/장 등). 벽 시공은 지원하지
            # 않는다 — 벽을 시공 대상 카테고리에 포함시켰더니 Gemini가 상/하부장
            # 문짝을 벽으로 잘못 분류하는 경우가 잦아(벽과 문짝 모두 평평하고 흰
            # 면이라 구분이 어려움), 문짝이 시공에서 통째로 빠지는 문제가 있었다.
            # 자동 시공 대상은 "평평한 패널"로 판정된 부위만 — 타일 벽/레인지후드/
            # 가전처럼 문짝이 아닌 것까지 색이 바뀌지 않게 한다. 판정된 게 하나도
            # 없으면(특이한 사진) 인식된 부위 전체로 폴백해 결과가 원본과 똑같이
            # 나오는 상황은 피한다.
            panels = [r["mask_path"] for r in regions_internal.values() if r.get("is_panel")]
            film_mask_paths = (panels or [r["mask_path"] for r in regions_internal.values()])[
                :MAX_AUTO_FILM_REGIONS
            ]

            if film_mask_paths:
                _stage(job_id, "시트지 색 입히는 중")
                film_mask_path = f"storage/results/{job_id}_film_mask.png"
                combine_masks(film_mask_paths).save(film_mask_path)

                pattern_applied_path = f"storage/results/{job_id}_pattern.png"
                # 색 변경은 디퓨전 인페인팅이 아니라 결정적 리컬러로 처리한다.
                # (이유는 rendering.recolor_surface의 주석 참고 — 인페인팅은
                # 마스크 안 원본 픽셀을 버리고 새로 그리기 때문에 요청한 색이
                # 반영되지 않고 결과가 원본과 거의 같게 나오는 문제가 있었다.)
                recolor_surface(
                    current_path,
                    film_mask_path,
                    pattern_meta["color_hex"],
                    pattern_applied_path,
                    wood_grain=_is_wood(options.film.pattern_id),
                )
                current_path = pattern_applied_path

        wants_fan = bool(
            not scene_rendered and "fan" in selected_items and options.fan and options.fan.fan_count
        )
        wants_lights = bool(
            not scene_rendered
            and "lighting" in selected_items
            and options.lighting
            and options.lighting.light_count
        )
        if wants_fan or wants_lights:
            _stage(job_id, "조명·실링팬 설치 중")
            current_path = _install_ceiling_fixtures(
                job_id, current_path, ceiling_mask_path, options, wants_fan, wants_lights
            )

        # 사진에서 기존 싱크볼 위치를 찾았다면(sink_bowl 카테고리), 그 자리에 새
        # 싱크볼/수전을 AI로 그려 넣는다 — 못 찾으면 견적만 반영하고 조용히 건너뛴다.
        if not scene_rendered and "sink" in selected_items and options.sink:
            sink_region = next((r for r in regions_internal.values() if r.get("category") == "sink_bowl"), None)
            if sink_region is not None:
                _stage(job_id, "싱크볼 교체 중")
                sink_applied_path = f"storage/results/{job_id}_sink.png"
                try:
                    result_bytes = inpaint_region(current_path, sink_region["mask_path"], _sink_prompt(options))
                    with open(sink_applied_path, "wb") as f:
                        f.write(result_bytes)
                    current_path = sink_applied_path
                except Exception as exc:
                    print(f"[pipeline] 싱크볼 AI 인페인팅 실패, 원본 유지: {exc}")

        final_path = f"storage/results/{job_id}_final.png"
        if current_path != final_path:
            shutil.copyfile(current_path, final_path)

        _stage(job_id, "견적 계산 중")
        estimate = calculate_estimate(
            selected_items=selected_items,
            options=options,
            ceiling_area_m2=room_info["ceiling_width_m"] * room_info["ceiling_length_m"],
        )

        JOBS[job_id].update(
            status="done",
            stage=None,
            original_image_url=_to_static_url(image_path),
            mask_preview_url=mask_preview_url,
            regions=regions,
            rendered_image_url=_to_static_url(final_path),
            estimate=estimate,
            regions_internal=regions_internal,
            current_image_path=final_path,
            editing=False,
            editing_region_id=None,
            edit_error=None,
            customer_name=customer_name,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        # 완료된 견적은 파일로 스냅샷을 남겨, 서버 재시작이나 브라우저 "뒤로가기"
        # 이후에도 job_id로 다시 조회하거나 "불러오기" 목록에서 찾을 수 있게 한다.
        save_quote(job_id, _quote_snapshot(job_id))
    except Exception as exc:  # noqa: BLE001 - 잡 상태로 노출해야 하는 최종 경계
        JOBS[job_id].update(status="failed", stage=None, error=str(exc))


def run_inpaint_edit(job_id: str, region_id: str, pattern_id: str) -> None:
    """클릭으로 선택한 부위 하나만 선택한 색으로 다시 칠한다.

    결정적 리컬러라 외부 API 호출이 없어 즉시(수십 ms) 끝난다 — 예전에는 부위
    하나 색을 바꿀 때마다 Replicate 인페인팅을 호출해 수십 초를 기다렸고,
    그러고도 색이 반영되지 않는 경우가 많았다.
    성공하면 job의 현재 이미지(current_image_path/rendered_image_url)를 교체해
    이후 편집이 이 결과 위에 계속 누적되도록 한다."""
    job = JOBS[job_id]
    try:
        region = job["regions_internal"][region_id]
        pattern = PATTERNS[pattern_id]

        edit_path = f"storage/results/{job_id}_edit_{uuid.uuid4().hex[:8]}.png"
        recolor_surface(
            job["current_image_path"],
            region["mask_path"],
            pattern["color_hex"],
            edit_path,
            wood_grain=_is_wood(pattern_id),
        )

        job["current_image_path"] = edit_path
        job["rendered_image_url"] = _to_static_url(edit_path)
        job["edit_error"] = None
        # 편집 결과도 저장된 견적서에 반영해, "불러오기"로 다시 열었을 때
        # 편집 전 사진이 아니라 최신 결과가 보이게 한다.
        save_quote(job_id, _quote_snapshot(job_id))
    except Exception as exc:  # noqa: BLE001 - 편집 실패는 전체 job을 죽이지 않고 별도로 알림
        job["edit_error"] = str(exc)
    finally:
        job["editing"] = False
        job["editing_region_id"] = None


def run_illustration_edit(job_id: str, text: str, description: str) -> None:
    """결과 사진 위에 고객이 원하는 문구/그림을 AI로 바로 그려 넣는다.

    상담 자리에서 "여기에 이런 문구를 넣으면 어때요?"를 즉석에서 보여주기 위한
    기능이라, 견적 폼을 다시 채워 처음부터 돌리지 않고 지금 보고 있는 시공 후
    사진에 바로 얹는다. 부위 리컬러(run_inpaint_edit)와 같은 editing 플래그를 써서
    프론트엔드 폴링 로직을 그대로 재사용한다."""
    job = JOBS[job_id]
    try:
        instruction = _illust_instruction(text, description)
        result_bytes = render_scene(job["current_image_path"], [instruction])

        edit_path = f"storage/results/{job_id}_illust_{uuid.uuid4().hex[:8]}.png"
        with open(edit_path, "wb") as f:
            f.write(result_bytes)

        job["current_image_path"] = edit_path
        job["rendered_image_url"] = _to_static_url(edit_path)
        job["edit_error"] = None
        save_quote(job_id, _quote_snapshot(job_id))
    except Exception as exc:  # noqa: BLE001 - 실패해도 기존 사진은 그대로 두고 사유만 알린다
        job["edit_error"] = f"일러스트 생성에 실패했습니다: {exc}"
    finally:
        job["editing"] = False
        job["editing_region_id"] = None


def _render_manual_regions(job_id: str, image_path: str, manual_regions: list[dict]) -> str:
    """지정된 영역들을 순서대로 렌더링해 한 장에 누적한다.

    한 번에 여러 영역을 보내지 않고 하나씩 겹쳐 쌓는 이유: 영역마다 taskType이
    달라(표면 변경 vs 물건 생성) 필요한 denoise 강도와 구조 보존 여부가 정반대다.
    앞 단계 결과 위에 다음 영역을 얹어야 조명이 바뀐 뒤의 빛을 반영한 시트지 색이
    나온다."""
    current = image_path
    total = len(manual_regions)
    for index, region in enumerate(manual_regions, start=1):
        # 영역 하나가 수십 초씩 걸리므로 단계 표시도 영역 단위로 갱신한다 —
        # 그래야 5곳을 칠한 현장에서도 "멈춘 것"과 "진행 중"이 구분된다.
        _stage(job_id, f"지정 영역 시공 중 ({index}/{total})")
        try:
            rendered = render_region(
                current,
                region["mask_path"],
                region.get("prompt") or region.get("option_label", ""),
                region.get("task_type", "surface_change"),
                region.get("custom_design", ""),
                region.get("option", ""),
                region.get("category", ""),
                region.get("door_material", "wood"),
            )
        except Exception as exc:  # noqa: BLE001 - 한 영역이 실패해도 나머지는 살린다
            print(f"[pipeline] 지정 영역 {index} 렌더링 실패, 건너뜀: {exc}")
            continue
        out_path = f"storage/results/{job_id}_manual{index}.png"
        rendered.save(out_path)
        current = out_path
    return current


def _regions_from_manual(manual_regions: list[dict]) -> dict:
    """수동으로 칠한 마스크들을 세그멘테이션 결과와 같은 모양으로 포장한다.
    이렇게 맞춰두면 이후 파이프라인(클릭 편집, 필름 리컬러)이 자동 모드와
    똑같은 코드로 돌아간다."""
    regions = []
    for index, region in enumerate(manual_regions, start=1):
        try:
            arr = np.array(Image.open(region["mask_path"]).convert("L")) > 127
            ys, xs = np.nonzero(arr)
            if len(xs) == 0:
                continue
            bbox = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min()), int(ys.max() - ys.min()))
        except Exception:  # noqa: BLE001 - 한 영역이 깨져도 나머지는 살린다
            continue
        # 구역마다 자재가 다르고 디자인까지 들어가므로, 결과 화면에서 어느 구역인지
        # 한눈에 구분되도록 라벨에 요청한 디자인을 짧게 덧붙인다.
        label = region.get("option_label") or f"지정 영역 {index}"
        design = (region.get("custom_design") or "").strip()
        if design:
            label = f"{label} · {design[:20]}{'…' if len(design) > 20 else ''}"
        regions.append(
            {
                "id": f"obj-{index}",
                "label": label,
                "category": region.get("category", "other"),
                "bbox": bbox,
                "mask_path": region["mask_path"],
                "is_panel": True,
            }
        )
    return {"regions": regions, "wall_is_estimated": False, "ceiling_is_estimated": False}


def _install_ceiling_fixtures(
    job_id: str,
    current_path: str,
    sam_ceiling_mask_path: str | None,
    options: JobOptions,
    wants_fan: bool,
    wants_lights: bool,
) -> str:
    """천장 시공을 순서대로 적용한다: 기존 등 철거 -> 실링팬 설치 -> 다운라이트 설치.

    기존 등을 지우지 않으면 "새 조명을 달았는데 옛날 등이 그대로 있는" 사진이 되어
    시공 후 모습으로 쓸 수 없다. 철거와 실링팬은 없던 형상을 만들어야 하므로 생성형
    AI 인페인팅, 다운라이트는 크기가 작아 디퓨전이 형태를 못 만들기 때문에 직접
    그리는 방식으로 나눈다.
    """
    ceiling_mask = _resolve_ceiling_mask(current_path, sam_ceiling_mask_path)
    placement = ceiling_placement(ceiling_mask) if ceiling_mask is not None else None
    if placement is None:
        # 천장을 전혀 못 찾으면 화면 상단을 천장으로 가정한다 (기존 동작).
        placement = {
            "y": 0.14,
            "x": 0.5,
            "x_min": 0.15,
            "x_max": 0.85,
            "y2": 0.22,
            "x_min2": 0.15,
            "x_max2": 0.85,
        }

    # 1) 기존 천장등 철거 — 고전 인페인팅(OpenCV Telea)으로 지운다. AI 인페인팅은
    # "빈 천장으로 채워라"라고 해도 마스크 모양(밝고 길쭉함) 자체를 광원이 있다는
    # 신호로 받아들여 비슷한 등을 다시 그려내는 문제가 있었다(rendering.
    # erase_ceiling_light 주석 참고).
    existing = detect_existing_lights(current_path, ceiling_mask)
    if existing is not None:
        removal_path = f"storage/results/{job_id}_light_removal_mask.png"
        existing.save(removal_path)
        cleared_path = f"storage/results/{job_id}_cleared.png"
        erase_ceiling_light(current_path, removal_path, cleared_path)
        current_path = cleared_path

    # 2) 실링팬 설치 (AI 생성)
    if wants_fan:
        fan_path = f"storage/results/{job_id}_fan.png"
        fan_fixture = {
            "x": placement["x"],
            "y": placement["y"],
            "scale": FAN_SCALE,
            "product_png_path": FIXTURE_PRODUCTS["ceiling_fan_basic"],
        }
        try:
            fan_mask = build_fixture_mask(current_path, [fan_fixture])
            fan_mask_path = f"storage/results/{job_id}_fan_mask.png"
            fan_mask.save(fan_mask_path)
            result_bytes = inpaint_region(current_path, fan_mask_path, _fan_prompt(options))
            with open(fan_path, "wb") as f:
                f.write(result_bytes)
            current_path = fan_path

            # 색상 프롬프트를 프롬프트에 넣어도 실측 결과 AI가 매번 짙은 회색/검정
            # 팬만 그려내는 경향이 있었다(navy/beige 요청 모두 결과가 거의 동일한
            # 검정 팬이었다) — 그래서 생성된 이미지에서 팬 몸체(원형 마스크 안의
            # 어두운 픽셀)만 다시 골라 recolor_surface로 확실하게 선택한 색을 입힌다.
            fan_color_id = options.fan.fan_color
            if fan_color_id and fan_color_id != "matte-black":
                dark_mask_path = f"storage/results/{job_id}_fan_dark_mask.png"
                build_dark_object_mask(current_path, fan_mask_path).save(dark_mask_path)
                fan_recolored_path = f"storage/results/{job_id}_fan_recolored.png"
                fan_color_hex = PATTERNS.get(fan_color_id, PATTERNS["matte-black"])["color_hex"]
                recolor_surface(current_path, dark_mask_path, fan_color_hex, fan_recolored_path)
                current_path = fan_recolored_path
        except Exception as exc:
            print(f"[pipeline] 실링팬 AI 인페인팅 실패, 제품 이미지 합성 폴백 사용: {exc}")
            # AI 경로가 실패해도 선택한 색이 안 보이면 안 되므로, 고정 검정 아이콘을
            # 선택한 색으로 물들인 뒤 합성한다.
            fan_color_hex = PATTERNS.get(options.fan.fan_color, PATTERNS["matte-black"])["color_hex"]
            tinted_path = f"storage/results/{job_id}_fan_tinted.png"
            tint_fixture_png(FIXTURE_PRODUCTS["ceiling_fan_basic"], fan_color_hex).save(tinted_path)
            fan_fixture["product_png_path"] = tinted_path
            composite_fixtures(
                current_path, [fan_fixture], fan_path, ceiling_mask_path=sam_ceiling_mask_path
            )
            current_path = fan_path

    # 3) 다운라이트 설치 (직접 렌더링)
    if wants_lights:
        spots = _downlight_spots(options.lighting.light_count, placement, bool(wants_fan))
        if spots:
            lights_path = f"storage/results/{job_id}_downlights.png"
            draw_downlights(current_path, spots, lights_path)
            current_path = lights_path

    return current_path


def _resolve_ceiling_mask(image_path: str, sam_ceiling_mask_path: str | None):
    """SAM이 실제로 찾아낸 천장 마스크를 우선 쓰되, 모양이 천장답지 않으면
    (예: 스테인리스 후드 덕트를 천장으로 잘못 고른 경우) 밝기 기반으로 직접 찾는
    detect_ceiling_mask로 대체한다 — is_plausible_ceiling 참고.
    (SAM 경로가 기하학적 추정 사각형일 때도 마찬가지로 벽/상부장 위에 팬이 얹힌다.)"""
    if sam_ceiling_mask_path:
        try:
            mask = Image.open(sam_ceiling_mask_path).convert("L")
            if is_plausible_ceiling(mask):
                return mask
            print(f"[pipeline] SAM 천장 마스크가 천장답지 않아 폐기, 밝기 기반으로 재탐색: {sam_ceiling_mask_path}")
        except OSError:
            pass
    return detect_ceiling_mask(image_path)


# 다운라이트가 이 개수 이상이면 한 줄로 늘어놓지 않고 2줄(그리드)로 나눠 배치한다
# — 실제 시공에서도 5~6개 이상은 한 줄로 붙여 달지 않고 격자로 배치한다.
DOWNLIGHT_GRID_THRESHOLD = 5


def _downlight_row(count: int, x_min: float, x_max: float, y: float, avoid_center: bool, fan_x: float) -> list[dict]:
    """다운라이트 count개를 [x_min, x_max] 구간 안에 한 줄로 균등 배치한다."""
    if count <= 0:
        return []
    inset = max(x_max - x_min, 0.1) * 0.12
    x_min, x_max = x_min + inset, x_max - inset

    def spread(lo: float, hi: float, n: int) -> list[float]:
        return [lo + (hi - lo) * (i + 1) / (n + 1) for i in range(n)]

    if avoid_center and count >= 2:
        margin = FAN_SCALE * 0.6  # 팬 날개 반경만큼 비워 둔다
        left_n = count // 2
        xs = spread(x_min, min(fan_x - margin, x_max), left_n)
        xs += spread(max(fan_x + margin, x_min), x_max, count - left_n)
    else:
        xs = spread(x_min, x_max, count)

    return [{"x": min(max(x, 0.03), 0.97), "y": y, "radius_ratio": DOWNLIGHT_RADIUS_RATIO} for x in xs]


def _downlight_spots(count: int, placement: dict, avoid_center: bool) -> list[dict]:
    """다운라이트를 천장 폭 안에 균등 배치한다. 개수가 많으면(DOWNLIGHT_GRID_THRESHOLD
    이상) 2줄로 나눠 격자 형태로 배치하고, 실링팬이 가운데를 차지하면 각 줄에서
    중앙을 비우고 좌/우로 나눠 단다 (실제 시공도 그렇게 한다)."""
    y1 = placement["y"] * DOWNLIGHT_ROW_FACTOR
    fan_x = placement["x"]

    if count < DOWNLIGHT_GRID_THRESHOLD:
        return _downlight_row(count, placement["x_min"], placement["x_max"], y1, avoid_center, fan_x)

    row1_n = -(-count // 2)  # 올림 — 앞줄이 한 개 더 많도록
    row2_n = count - row1_n
    y2 = placement.get("y2", placement["y"]) * DOWNLIGHT_ROW_FACTOR
    return _downlight_row(row1_n, placement["x_min"], placement["x_max"], y1, avoid_center, fan_x) + _downlight_row(
        row2_n, placement.get("x_min2", placement["x_min"]), placement.get("x_max2", placement["x_max"]), y2, avoid_center, fan_x
    )


def _build_scene_instructions(
    selected_items: list[str],
    options: JobOptions,
    illustration_text: str = "",
    illustration_description: str = "",
) -> list[str]:
    """선택한 시공 항목 전체를 Gemini 이미지 편집 모델에 줄 영어 지시문 목록으로 만든다.

    한 번의 호출로 필름/조명/실링팬/싱크볼을 모두 반영해야 결과가 서로 어긋나지 않고
    "한 번에 리모델링을 마친 사진"처럼 일관되게 나온다."""
    instructions: list[str] = []

    if "film" in selected_items and options.film:
        # FAN_BLADE_COLOR_PROMPTS는 PATTERNS와 같은 색상 id를 쓰는 영어 색상 표현
        # 사전이라 필름 색상 문구에도 그대로 재사용한다.
        color_phrase = FAN_BLADE_COLOR_PROMPTS.get(options.film.pattern_id, "matte white")
        targets = _film_target_phrases(options.film)
        if targets:
            instructions.append(
                f"Refinish the {', '.join(targets)} with a {color_phrase} interior film — "
                "keep the existing door/panel shapes, handles and hinges exactly as they are, "
                "only the surface finish changes."
            )

    if "sash" in selected_items and options.sash and any(f.count > 0 for f in options.sash.frames):
        sash_color = FAN_BLADE_COLOR_PROMPTS.get(options.sash.pattern_id, "matte white")
        instructions.append(
            f"Refinish the window frames (sash) with a {sash_color} interior film — keep the "
            "window glass, handles and opening direction exactly as they are."
        )

    if "glass" in selected_items and options.glass:
        glass = options.glass
        if glass.work_type in ("tint", "both") and any(p.count > 0 for p in glass.panels):
            tint_phrase = GLASS_TINT_TYPES[glass.tint_type]["prompt_keyword"]
            instructions.append(
                f"Apply {tint_phrase} to the glass door and glass panels, evenly covering the "
                "glass without touching the frame."
            )
        if glass.work_type in ("illust", "both") and glass.illust_count > 0:
            # 문구·그림 설명을 안 적었어도 일러스트 건수를 넣었으면 대표 그래픽은 보여준다.
            if not illustration_text.strip() and not illustration_description.strip():
                instructions.append(_illust_instruction("", ""))

    if "lighting" in selected_items and options.lighting and options.lighting.light_count:
        count = options.lighting.light_count
        instructions.append(
            f"Remove every existing ceiling light fixture, then install {count} recessed LED "
            f"downlights ({options.lighting.inch} inch) flush in the ceiling, spaced evenly "
            "across the ceiling and switched on."
        )

    if "fan" in selected_items and options.fan and options.fan.fan_count:
        blade_color = FAN_BLADE_COLOR_PROMPTS.get(options.fan.fan_color, "matte black")
        count = options.fan.fan_count
        subject = "a modern ceiling fan" if count <= 1 else f"{count} modern ceiling fans"
        instructions.append(
            f"Install {subject} with {blade_color} blades mounted flush on the ceiling, "
            "with a short downrod and no extra pendant lamp."
        )

    # 사진 아래에서 받은 일러스트 요청은 시공 항목 선택과 무관하게 항상 반영한다.
    if illustration_text.strip() or illustration_description.strip():
        instructions.append(_illust_instruction(illustration_text, illustration_description))

    if "sink" in selected_items and options.sink:
        bowl = SINK_BOWL_SPECS[options.sink.spec]["prompt_keyword"]
        faucet = FAUCET_TYPES[options.sink.faucet_type]["prompt_keyword"]
        drain = DRAIN_TYPES[options.sink.drain_type]["prompt_keyword"]
        sink_phrase = f"Replace the existing kitchen sink with {bowl}"
        if faucet:
            sink_phrase += f" {faucet}"
        instructions.append(f"{sink_phrase}, with a {drain}, installed flush in the countertop.")

    return instructions


def _illust_instruction(text: str, description: str) -> str:
    """유리 일러스트 시공 지시문. 사장님이 입력한 문구/디자인 설명을 그대로 반영해
    AI가 시공 후 사진에 그 그래픽을 그려 넣게 한다.

    문구는 따옴표로 감싸 "이 글자를 정확히 이 철자로 넣어라"라고 못 박는다 —
    이미지 생성 모델은 글자를 흘려 쓰거나 철자를 바꾸는 경향이 있어, 명시하지
    않으면 엉뚱한 글자가 들어간다."""
    # 유리문이 없는 사진(주방 등)에서도 쓸 수 있어야 하므로 부착면을 유리로 못
    # 박지 않는다 — 일러스트 필름은 유리뿐 아니라 문짝/장 표면에도 시공한다.
    parts = [
        "Apply a cut-vinyl decorative film graphic onto the most suitable flat surface "
        "(a glass door or panel if there is one, otherwise a cabinet door front)"
    ]
    if description.strip():
        parts.append(f"the design is: {description.strip()}")
    if text.strip():
        parts.append(
            f'include the exact text "{text.strip()}" spelled exactly like that, '
            "in a clean legible font, well centred and correctly proportioned"
        )
    parts.append("modest in size, applied flat on the glass with no shadow or 3D effect")
    return ", ".join(parts) + "."


def _film_target_phrases(film) -> list[str]:
    """필름 견적 폼에서 실제로 수량을 입력한 부위만 시공 대상으로 지시문에 넣는다 —
    입력하지도 않은 부위까지 AI가 임의로 바꾸면 견적과 사진이 어긋난다."""
    mapping = [
        (film.upper_cabinets, "upper kitchen cabinet doors"),
        (film.lower_cabinets, "lower kitchen cabinet doors"),
        (film.island_tables, "kitchen island panels"),
        (film.doors, "room doors"),
        (film.doorframes, "door frames"),
        (film.fridge_cabinets, "tall refrigerator cabinet"),
        (film.pantry_cabinets, "pantry cabinet"),
        (film.shoe_cabinets, "shoe cabinet"),
    ]
    targets = [phrase for items, phrase in mapping if any(i.count > 0 for i in items)]
    if film.molding_length_m > 0:
        targets.append("baseboards and moldings")
    # 아무 부위도 입력하지 않았으면 주방장 전체를 기본 대상으로 삼는다 —
    # 색상만 고르고 치수는 나중에 넣는 사용 흐름이 흔하기 때문이다.
    return targets or ["upper and lower kitchen cabinet doors"]


def _is_wood(pattern_id: str) -> bool:
    """우드 계열 필름은 단색이 아니라 나뭇결이 보여야 실제 시공처럼 보인다."""
    return "wood" in pattern_id


def _fan_prompt(options: JobOptions) -> str:
    n = options.fan.fan_count if options.fan else 1
    color_phrase = FAN_BLADE_COLOR_PROMPTS.get(
        options.fan.fan_color if options.fan else "matte-black", "matte black"
    )
    subject = (
        f"a modern ceiling fan with {color_phrase} blades"
        if n <= 1
        else f"{n} modern ceiling fans with {color_phrase} blades"
    )
    # "no light kit" 등을 명시하지 않으면 마스크 안 넓은 여백을 AI가 임의로 채우려
    # 들어, 요청하지 않은 별도의 펜던트 조명/전구 덮개를 팬 옆에 하나 더 그려 넣는
    # 경우가 있었다(실측). 팬 몸체와 날개만 그리도록 못 박는다.
    return (
        f"{subject} mounted on the ceiling, short downrod, motor housing and blades only, "
        "no light kit, no pendant lamp, no additional hanging light fixture, "
        "photorealistic, professionally installed, matching the room's ambient lighting and shadows, "
        "high quality interior photography"
    )


def _sink_prompt(options: JobOptions) -> str:
    sink = options.sink
    bowl = SINK_BOWL_SPECS[sink.spec]["prompt_keyword"]
    faucet = FAUCET_TYPES[sink.faucet_type]["prompt_keyword"]
    drain = DRAIN_TYPES[sink.drain_type]["prompt_keyword"]
    parts = [bowl]
    if faucet:
        parts.append(faucet)
    return (
        f"{' '.join(parts)}, with a {drain}, photorealistic, professionally installed, "
        "seamlessly integrated into the countertop, matching the room's ambient lighting, "
        "high quality interior photography"
    )


def run_remask(job_id: str, regions: list[dict]) -> None:
    """결과 사진 위에서 구역을 다시 잡아 그 부분만 새로 렌더링한다.

    [원본이 아니라 '현재 결과 사진'을 바탕으로 삼는 이유]
    사장님이 고객 앞에서 "여기는 검정으로 바꿔볼까요" 하고 한 곳씩 다듬는 작업이다.
    원본에서 다시 시작하면 앞서 정한 시공이 전부 사라져, 고칠 때마다 처음부터
    다시 잡아야 한다. 이미 만들어 둔 결과에 덧대야 대화가 이어진다."""
    job = JOBS.get(job_id)
    if job is None:
        return
    base_path = job.get("current_image_path") or job.get("rendered_image_path")
    if not base_path:
        job.update(editing=False, edit_error="다시 손볼 시공 후 사진이 없습니다.")
        return

    try:
        _stage(job_id, f"지정 영역 다시 시공 중 (0/{len(regions)})")
        current = base_path
        applied = 0
        for index, region in enumerate(regions, start=1):
            _stage(job_id, f"지정 영역 다시 시공 중 ({index}/{len(regions)})")
            try:
                rendered = render_region(
                    current,
                    region["mask_path"],
                    region.get("prompt", ""),
                    region.get("task_type", "surface_change"),
                    region.get("custom_design", ""),
                    region.get("option", ""),
                    region.get("category", ""),
                    region.get("door_material", "wood"),
                )
            except Exception as exc:  # noqa: BLE001 - 한 구역이 실패해도 나머지는 살린다
                print(f"[pipeline] 재시공 영역 {index} 실패, 건너뜀: {exc}")
                continue
            out_path = f"storage/results/{job_id}_remask{uuid.uuid4().hex[:8]}.png"
            rendered.save(out_path)
            current = out_path
            applied += 1

        if applied == 0:
            job.update(editing=False, stage=None, edit_error="지정한 구역을 다시 그리지 못했습니다.")
            return

        job.update(
            editing=False,
            editing_region_id=None,
            edit_error=None,
            stage=None,
            current_image_path=current,
            rendered_image_url=_to_static_url(current),
            # 원래 견적 시각이 없던 job이면 지금 시각으로 채운다 — 비워 두면
            # 견적서 목록 정렬이 None을 만나 통째로 실패한다(quotes_store 주석 참고).
            created_at=job.get("created_at") or datetime.now(timezone.utc).isoformat(),
        )
        save_quote(job_id, _quote_snapshot(job_id))
    except Exception as exc:  # noqa: BLE001 - 편집 실패는 job을 죽이지 않고 메시지로만
        job.update(editing=False, stage=None, edit_error=str(exc))
