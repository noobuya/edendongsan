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

/** 결(무늬) 시공 방향 화살표 — ↕(세워서 시공)·↔(눕혀서 시공). */
export type GrainDirection = "↕" | "↔";

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
  /** 시공자용 뒷면 마킹에 쓰는 방 이름(선택 입력), 예: "안방". 비어 있으면 라벨에서 빠진다. */
  roomName?: string;
  /** 결(무늬) 시공 방향 — dimWithArrow/grainDirectionOf로 함께 계산해 넘기면 된다. */
  grainDirection?: GrainDirection;
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
  /** 마지막 선반(계단식 재단의 맨 끝 "계단")에 남은 자투리가 대리점에 반납할 만큼
   *  크면(남은 폭 1,200mm 이상 & 그 선반 길이 1,000mm 이상) 채워진다. 전체 구매 길이
   *  기준 반납 가능 여부(RETURN_MIN_LENGTH_M, 호출하는 쪽 책임)와는 별개의, "안내도에
   *  실제로 보이는 사각형 자투리" 단위 감지다 — 두 개념을 섞지 않는다. */
  refundableLoss?: { areaM2: number; estimatedRefund: number };
}

const REFUNDABLE_MIN_WIDTH_MM = 1200;
const REFUNDABLE_MIN_LENGTH_MM = 1000;
/** 원/m — 표준 1.22m 장폭 기준 임시 환불 단가. 실제 거래 단가로 나중에 바꿔 끼울 수 있게
 *  이 상수 하나만 고치면 된다. */
const REFUND_RATE_PER_M = 7000;

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

  // 계단식 절단 자투리 감지 — 맨 마지막에 연 선반만 본다. 그 앞 선반들은 FFDH가 거의 꽉
  // 채우고 넘어간 것들이라 남는 폭이 작지만, 마지막 선반은 더 채울 조각이 없어 열어둔
  // 채로 끝나는 경우가 많아 실제로 반납 가치가 있는 자투리가 나오는 지점이다.
  const lastShelf = shelves[shelves.length - 1];
  let refundableLoss: NestingResult["refundableLoss"];
  if (lastShelf) {
    const remainingWidthMm = rollWidthMm - lastShelf.usedWidthMm;
    if (remainingWidthMm >= REFUNDABLE_MIN_WIDTH_MM && lastShelf.heightMm >= REFUNDABLE_MIN_LENGTH_MM) {
      const areaM2 = (remainingWidthMm / 1000) * (lastShelf.heightMm / 1000);
      const estimatedRefund = Math.round((lastShelf.heightMm / 1000) * REFUND_RATE_PER_M);
      refundableLoss = { areaM2, estimatedRefund };
    }
  }

  return { shelves, totalLengthMm, usedAreaM2, consumedAreaM2, utilizationPercent, refundableLoss };
}

/** 치수 + 결 방향 화살표 문자열 — "160×2000 (↕)". 세로(결 방향, cutHMm)가 가로(cutWMm)보다
 *  길거나 같으면 세워서 시공(↕), 더 짧으면(가로로 긴 몰딩·가로대 등) 눕혀서 시공(↔). */
export function dimWithArrow(cutWMm: number, cutHMm: number): string {
  const arrow = grainDirectionOf(cutWMm, cutHMm);
  return `${Math.round(cutWMm).toLocaleString("ko-KR")}×${Math.round(cutHMm).toLocaleString("ko-KR")} (${arrow})`;
}

export function grainDirectionOf(cutWMm: number, cutHMm: number): GrainDirection {
  return cutHMm >= cutWMm ? "↕" : "↔";
}

/** 재단 리스트·2D 안내도에서 짧게 붙일 조각 표식 — "기둥-좌"→"좌", "알판-좌상"→"좌상". */
function shortPartLabel(part: string): string {
  const idx = part.indexOf("-");
  return idx === -1 ? part : part.slice(idx + 1);
}

/** 시공자용 뒷면 마킹 — "[1번/안방]" 형태. 같은 번호가 카테고리마다 따로 매겨지므로
 *  (문1·샷1처럼 독립 채번) 카테고리 한 글자 표식을 번호 앞에 붙여 서로 다른 부위의
 *  같은 번호가 섞여도 헷갈리지 않게 한다. 방 이름을 안 넣었으면 뒤 "/방이름"은 뺀다. */
export function backMarkLabel(shortLabel: string, seq: number, part: string | undefined, roomName: string | undefined): string {
  const partSuffix = part ? `-${shortPartLabel(part)}` : "";
  const numberPart = `${shortLabel}${seq}번${partSuffix}`;
  return roomName ? `[${numberPart}/${roomName}]` : `[${numberPart}]`;
}
