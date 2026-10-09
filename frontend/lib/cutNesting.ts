/** 재단 리스트를 1,220mm 폭 원단 위에 실제로 어떻게 늘어놓을지 계산한다.
 *
 * [왜 진짜 최적 배치(nesting)가 아니라 "선반(shelf)" 배치인가]
 * 일반적인 2D 사각형 배치(직사각형을 돌려 가며 빈틈에 끼워 넣는 진짜 nesting)는
 * NP-hard 문제라 완벽한 최적해를 구하는 게 아니라 근사 알고리즘을 쓴다. 게다가 이
 * 앱이 다루는 재료는 고정된 시트가 아니라 "폭 1,220mm, 길이는 마음대로 풀어 쓰는 롤"이라
 * 실제 현장에서도 조각을 세로로 돌려 끼우지 않고, 폭 방향으로 나란히 줄을 세운 뒤
 * 한 줄이 끝나면(그 줄에서 가장 긴 조각만큼) 롤을 더 풀어 다음 줄을 잘라내는 방식으로
 * 재단한다 — 그래서 "선반에 물건을 얹듯" 폭 방향으로 채우는 First-Fit Decreasing
 * Height(FFDH) 알고리즘이 실제 작업 방식과 그대로 들어맞고, 계산도 예측 가능하다.
 * 결(나뭇결·무늬 방향)이 있는 조각(hasGrain=true)은 절대 돌리지 않는다 — 맘대로
 * 돌리면 시공 후 무늬 방향이 어긋나 보이기 때문이다. 민무늬 조각(hasGrain=false)만,
 * 원래 방향으로 기존 선반에 못 들어갈 때 한해 90도로 돌려 다시 끼워 넣어 본다(로스를
 * 줄이는 선에서만 — 새 선반을 여는 것보다 기존 선반 빈 폭에 끼우는 게 항상 이득이다).
 */

export interface NestingPiece {
  id: string;
  /** 화면에 보여줄 짧은 라벨, 예: "문1". */
  label: string;
  /** 조각 위에 함께 적을 실제 치수 글자, 예: "900×2100". 재단 목록에 쓰는 표기와
   *  같은 순서를 쓴다 — 안내도와 목록에서 같은 숫자, 같은 순서로 읽혀야 헷갈리지 않는다. */
  dimLabel: string;
  /** 조각 색을 구분하는 그룹 키(카테고리). */
  groupKey: string;
  widthMm: number;
  heightMm: number;
  /** 우드·마블 등 결(무늬)이 있는 자재면 true — true인 조각은 절대 90도로 돌려
   *  배치하지 않는다(폭↔길이가 바뀌면 결 방향이 어긋나 보인다). false(민무늬)인
   *  조각만 기존 선반에 더 끼워 넣을 자리가 있을 때 한해 돌려서 로스를 줄인다. */
  hasGrain: boolean;
}

export interface PlacedPiece extends NestingPiece {
  x: number;
  y: number;
  /** 배치 과정에서 90도 돌아갔는지(hasGrain=false인 조각만 해당). widthMm/heightMm은
   *  이미 돌아간 뒤의 값이므로, 그리는 쪽은 이 값을 신경 쓰지 않고 그대로 써도 된다 —
   *  재단 지시서처럼 "원래 치수"를 다시 말해야 하는 곳에서만 참고하면 된다. */
  rotated: boolean;
}

export interface NestingShelf {
  y: number;
  heightMm: number;
  usedWidthMm: number;
  pieces: PlacedPiece[];
}

export interface NestingResult {
  shelves: NestingShelf[];
  totalLengthMm: number;
  /** 조각들이 실제로 차지하는 면적 합(㎡). */
  usedAreaM2: number;
  /** 롤에서 실제로 소비한 면적(㎡) — 선반별 자투리(로스)까지 포함. */
  consumedAreaM2: number;
  /** 원단 활용률(%) = 조각 면적 / 소비 면적. 나머지는 선반마다 남는 자투리 폭이다. */
  utilizationPercent: number;
}

export function packShelves(pieces: NestingPiece[], rollWidthMm: number): NestingResult {
  // 큰 조각부터 채워야(First-Fit Decreasing Height) 좁은 자투리가 덜 남는다 —
  // 작은 조각을 먼저 흩어 놓으면 큰 조각이 들어갈 자리가 없어 선반이 쓸데없이 늘어난다.
  // 길이(heightMm)가 같으면 폭(widthMm)이 넓은 것부터 — 폭이 좁은 조각을 먼저 선반에
  // 올리면 뒤에 오는 더 넓은 동일 길이 조각이 그 선반에 못 들어가 새 선반을 여는 경우가
  // 생긴다. 넓은 것부터 꽂아야 그 뒤 좁은 조각들이 남는 자리에 더 잘 끼워진다.
  const sorted = [...pieces].sort((a, b) => b.heightMm - a.heightMm || b.widthMm - a.widthMm);
  const shelves: NestingShelf[] = [];

  for (const piece of sorted) {
    if (piece.widthMm <= 0 || piece.heightMm <= 0) continue;

    let shelf = shelves.find((s) => s.usedWidthMm + piece.widthMm <= rollWidthMm);
    let rotated = false;

    // 원래 방향으로 기존 선반에 못 들어가면, 결이 없는 조각(hasGrain=false)만 90도
    // 돌려서 다시 시도한다 — 새 선반을 열지는 않는다(새 선반을 열 거면 원래 방향이
    // 길이 내림차순 정렬을 그대로 지켜야 선반 높이가 예측 가능하게 줄어든다).
    if (!shelf && !piece.hasGrain) {
      shelf = shelves.find((s) => s.heightMm >= piece.widthMm && s.usedWidthMm + piece.heightMm <= rollWidthMm);
      if (shelf) rotated = true;
    }

    if (!shelf) {
      const y = shelves.reduce((sum, s) => sum + s.heightMm, 0);
      shelf = { y, heightMm: piece.heightMm, usedWidthMm: 0, pieces: [] };
      shelves.push(shelf);
    }

    const placedWidthMm = rotated ? piece.heightMm : piece.widthMm;
    const placedHeightMm = rotated ? piece.widthMm : piece.heightMm;
    shelf.pieces.push({ ...piece, x: shelf.usedWidthMm, y: shelf.y, widthMm: placedWidthMm, heightMm: placedHeightMm, rotated });
    shelf.usedWidthMm += placedWidthMm;
  }

  const totalLengthMm = shelves.reduce((sum, s) => sum + s.heightMm, 0);
  const usedAreaM2 = pieces.reduce((sum, p) => sum + (p.widthMm / 1000) * (p.heightMm / 1000), 0);
  const consumedAreaM2 = (rollWidthMm / 1000) * (totalLengthMm / 1000);
  const utilizationPercent = consumedAreaM2 > 0 ? (usedAreaM2 / consumedAreaM2) * 100 : 0;

  return { shelves, totalLengthMm, usedAreaM2, consumedAreaM2, utilizationPercent };
}
