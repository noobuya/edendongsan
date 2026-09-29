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
 * 조각은 돌리지 않는다(회전 허용 안 함) — 필름은 결(나뭇결 방향 등)이 있어 맘대로
 * 돌리면 시공 후 무늬 방향이 어긋날 수 있기 때문이다.
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
}

export interface PlacedPiece extends NestingPiece {
  x: number;
  y: number;
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
  const sorted = [...pieces].sort((a, b) => b.heightMm - a.heightMm);
  const shelves: NestingShelf[] = [];

  for (const piece of sorted) {
    if (piece.widthMm <= 0 || piece.heightMm <= 0) continue;
    let shelf = shelves.find((s) => s.usedWidthMm + piece.widthMm <= rollWidthMm);
    if (!shelf) {
      const y = shelves.reduce((sum, s) => sum + s.heightMm, 0);
      shelf = { y, heightMm: piece.heightMm, usedWidthMm: 0, pieces: [] };
      shelves.push(shelf);
    }
    shelf.pieces.push({ ...piece, x: shelf.usedWidthMm, y: shelf.y });
    shelf.usedWidthMm += piece.widthMm;
  }

  const totalLengthMm = shelves.reduce((sum, s) => sum + s.heightMm, 0);
  const usedAreaM2 = pieces.reduce((sum, p) => sum + (p.widthMm / 1000) * (p.heightMm / 1000), 0);
  const consumedAreaM2 = (rollWidthMm / 1000) * (totalLengthMm / 1000);
  const utilizationPercent = consumedAreaM2 > 0 ? (usedAreaM2 / consumedAreaM2) * 100 : 0;

  return { shelves, totalLengthMm, usedAreaM2, consumedAreaM2, utilizationPercent };
}
