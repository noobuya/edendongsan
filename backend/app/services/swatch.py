"""필름 견본 사진에서 "실제 자재가 찍힌 부분"만 잘라낸다.

[왜 필요한가 — 연습21 책장 사고 (2026-11-02)]
사장님이 찍어 올리는 견본 사진은 자재만 꽉 차게 찍힌 사진이 아니라, 카탈로그
한 페이지(흰 종이 여백 + "SPW60" 같은 품번 글자 + 책상/바닥 배경)를 통째로 찍은
사진인 경우가 많다. 그대로 쓰면 세 군데가 동시에 망가졌다.
  1. 견본 평균색이 종이 흰색·배경 검정과 섞여 회색(#7b6f65)이 됨 → 갈색으로 잘
     입힌 AI 결과를 "목표 색과 다르다"며 버리고 폴백으로 덮어씀
  2. 그 폴백(거울 타일링)이 종이 여백·품번 글자까지 타일로 깔아 가구 위에 흰 격자가 생김
  3. AI 편집 모델에도 종이·글자가 섞인 참고 사진이 들어감
그래서 저장하는 순간 자재 부분만 남긴다 — 이후 AI 참고 이미지·평균색·질감 폴백이
모두 이 잘라낸 사진을 쓴다.

[방법]
색 경계로 사진을 면들로 나누고, 흰 종이가 아닌 "크고 반듯한 사각형" 면을 자재로
골라 그 안에 거의 꽉 차는 사각형을 잘라낸다(extract_swatch_patch 주석 참고).
못 찾으면(이미 자재만 꽉 차게 찍은 사진 등) 원본을 그대로 돌려준다 — 이 함수가
견본을 망가뜨리는 일은 없어야 한다."""

import cv2
import numpy as np
from PIL import Image

_WORK_SIDE = 480  # 판정은 작게 줄여서 한다(속도·잡음 둘 다 유리)
_MIN_AREA_RATIO = 0.04  # 자재 덩어리가 사진의 4%도 안 되면 판정 실패로 본다
_MAX_AREA_RATIO = 0.92  # 거의 전부가 자재면 자를 게 없다 — 원본 그대로
_INNER_FILL = 0.97  # 잘라낼 사각형 안이 이 비율 이상 자재여야 한다


def _shrink_to_filled_box(blob: np.ndarray) -> tuple[int, int, int, int]:
    """덩어리 바운딩 박스에서 시작해, 안쪽이 거의 다 자재가 될 때까지 가장 "자재가
    아닌 픽셀이 많은" 변을 한 줄씩 안으로 민다."""
    ys, xs = np.where(blob)
    top, bottom, left, right = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    while bottom - top > 8 and right - left > 8:
        box = blob[top : bottom + 1, left : right + 1]
        if box.mean() >= _INNER_FILL:
            break
        edges = {
            "top": 1 - box[0].mean(),
            "bottom": 1 - box[-1].mean(),
            "left": 1 - box[:, 0].mean(),
            "right": 1 - box[:, -1].mean(),
        }
        side = max(edges, key=edges.get)
        if side == "top":
            top += 1
        elif side == "bottom":
            bottom -= 1
        elif side == "left":
            left += 1
        else:
            right -= 1
    return top, bottom, left, right


def _extract_by_rectangles(img: Image.Image) -> Image.Image:
    """[2026-11-02 v2 — 견본이 사진 가운데에 있다는 가정 제거]
    처음엔 "사진 가운데 색"을 자재 색으로 봤는데, 연습22의 VM911 견본 사진은 자재가
    위쪽 절반에 있고 가운데는 흰 종이였다 → 자르기 실패, 종이·배경이 그대로 들어감.
    지금은 색이 비슷하게 이어진 면들을 전부 찾아, 그중 "크고 반듯한 사각형"이면서
    흰 종이(밝고 무채색)가 아닌 면을 자재로 고른다. 사진 테두리 세 변 이상에 닿는
    면(책상·바닥 배경)은 감점한다."""
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[:2]
    scale = min(1.0, _WORK_SIDE / max(h, w))
    sw, sh = max(1, int(w * scale)), max(1, int(h * scale))
    small = cv2.resize(rgb, (sw, sh), interpolation=cv2.INTER_AREA)
    blurred = cv2.GaussianBlur(small, (0, 0), max(1.0, sw * 0.008))
    lab = cv2.cvtColor(blurred, cv2.COLOR_RGB2LAB).astype(np.float32)

    # 색 경계(종이↔자재, 자재↔배경)를 끊어서 면을 나눈다. 나뭇결·패브릭 같은 잔무늬는
    # 위에서 흐리게 해 경계로 안 잡히게 한다.
    grad = np.zeros((sh, sw), np.float32)
    for ch in range(3):
        gx = cv2.Sobel(lab[..., ch], cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(lab[..., ch], cv2.CV_32F, 0, 1, ksize=3)
        grad = np.maximum(grad, np.hypot(gx, gy))
    edge = (grad > max(24.0, float(np.percentile(grad, 85)))).astype(np.uint8)
    edge = cv2.dilate(edge, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(1 - edge, connectivity=4)

    best, best_score = None, 0.0
    for i in range(1, count):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < _MIN_AREA_RATIO * sw * sh:
            continue
        x, y, bw, bh = stats[i, :4]
        blob = labels == i
        fill = area / float(bw * bh)
        mean = lab[blob].mean(axis=0)
        chroma = float(np.hypot(mean[1] - 128, mean[2] - 128))
        if mean[0] > 205 and chroma < 10:
            continue  # 흰 종이
        borders = int(x <= 1) + int(y <= 1) + int(x + bw >= sw - 1) + int(y + bh >= sh - 1)
        score = area * fill**2 * (0.3 if borders >= 3 else 1.0)
        if score > best_score:
            best, best_score = blob, score
    if best is None:
        return img
    # 경계 띠(dilate로 깎인 부분)를 되돌려 덩어리를 원래 크기에 가깝게
    best = cv2.dilate(best.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    area_ratio = float(best.mean())
    if area_ratio > _MAX_AREA_RATIO:
        return img

    top, bottom, left, right = _shrink_to_filled_box(best)
    # 경계 그라데이션(종이와 자재 사이 그림자)을 피하려고 한 번 더 살짝 안쪽으로.
    pad_y, pad_x = int((bottom - top) * 0.03), int((right - left) * 0.03)
    top, bottom, left, right = top + pad_y, bottom - pad_y, left + pad_x, right - pad_x
    box_ratio = (bottom - top) * (right - left) / float(sw * sh)
    if box_ratio < _MIN_AREA_RATIO or box_ratio > _MAX_AREA_RATIO:
        return img
    inv = 1.0 / scale
    return img.crop((int(left * inv), int(top * inv), int((right + 1) * inv), int((bottom + 1) * inv)))


def _extract_by_center(img: Image.Image) -> Image.Image:
    """사진 가운데 색을 기준으로 그 색과 비슷한 픽셀이 이어진 덩어리를 찾는다 —
    나뭇결·마블처럼 무늬가 있어 색 경계 방식(_extract_by_rectangles)이 면을 잘게
    쪼개 버리는 견본에 강하다. 견본이 가운데 있지 않으면 실패(원본 그대로)한다."""
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[:2]
    scale = min(1.0, _WORK_SIDE / max(h, w))
    sw, sh = max(1, int(w * scale)), max(1, int(h * scale))
    small = cv2.resize(rgb, (sw, sh), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(cv2.GaussianBlur(small, (0, 0), max(1.0, sw * 0.012)), cv2.COLOR_RGB2LAB).astype(np.float32)

    cy, cx = sh // 2, sw // 2
    ry, rx = max(2, sh // 12), max(2, sw // 12)
    center = lab[cy - ry : cy + ry, cx - rx : cx + rx].reshape(-1, 3)
    ref = np.median(center, axis=0)
    spread = float(np.linalg.norm(center - ref, axis=1).mean())
    if spread > 25:
        return img  # 가운데가 이미 두 가지 이상의 면에 걸쳐 있다 — 이 방식으론 못 고른다
    threshold = max(14.0, spread * 3.0)

    similar = (np.linalg.norm(lab - ref, axis=2) < threshold).astype(np.uint8)
    similar = cv2.morphologyEx(similar, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels = cv2.connectedComponents(similar)
    if count <= 1 or labels[cy, cx] == 0:
        return img
    blob = labels == labels[cy, cx]
    if not (_MIN_AREA_RATIO <= float(blob.mean()) <= _MAX_AREA_RATIO):
        return img

    top, bottom, left, right = _shrink_to_filled_box(blob)
    pad_y, pad_x = int((bottom - top) * 0.03), int((right - left) * 0.03)
    top, bottom, left, right = top + pad_y, bottom - pad_y, left + pad_x, right - pad_x
    box_ratio = (bottom - top) * (right - left) / float(sw * sh)
    if box_ratio < _MIN_AREA_RATIO or box_ratio > _MAX_AREA_RATIO:
        return img
    inv = 1.0 / scale
    return img.crop((int(left * inv), int(top * inv), int((right + 1) * inv), int((bottom + 1) * inv)))


def extract_swatch_patch(img: Image.Image) -> Image.Image:
    """가운데 색 기준(무늬 있는 견본에 강함)을 먼저, 실패하면 반듯한 사각형 면 기준
    (견본이 가운데 있지 않은 사진)으로 찾는다. 둘 다 실패하면 원본 그대로."""
    for finder in (_extract_by_center, _extract_by_rectangles):
        patch = finder(img)
        if patch is not img:
            return patch
    return img
