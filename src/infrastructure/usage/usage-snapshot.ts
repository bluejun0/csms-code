/** 사용처 색인의 디스크 표현 — 형식·검증·비교·행 인코딩만. fs·zlib을 모른다. */
export const SNAPSHOT_VERSION = 1;

/** 파일 도장 행 — [루트 상대 경로, mtimeMs, size]. size가 음수면 "모름"(다음 검증에서 다시 읽는다). */
export type StampRow = [string, number, number];

export interface UsageSnapshot {
  v: number;
  /** 확장 버전 — 추출 규칙이 바뀌면 옛 색인은 거짓말을 한다. */
  ext: string;
  root: string;
  /** 스캔한 파일 전부. 항목이 없는 파일도 담아야 다음 검증에서 그것들을 다시 읽지 않는다. */
  files: StampRow[];
  s: (string | number)[];   // 문자열: [fileIdx, n, (component, key, line, column) × n] 반복
  t: (string | number)[];   // 템플릿: [fileIdx, n, (ref, line, column) × n]
  a: (string | number)[];   // AMD: 템플릿과 같은 모양
  c: (string | number)[];   // 설정: [fileIdx, n, (id, line, column) × n]
}

/** 형태·형식 버전·확장 버전·루트가 모두 맞아야 쓸 수 있다. 하나라도 어긋나면 버린다(침묵). */
export function isSnapshotUsable(value: unknown, root: string, extVersion: string): value is UsageSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<UsageSnapshot>;
  if (s.v !== SNAPSHOT_VERSION || s.ext !== extVersion || s.root !== root) return false;
  return Array.isArray(s.files) && Array.isArray(s.s) && Array.isArray(s.t) && Array.isArray(s.a) && Array.isArray(s.c);
}

/** 캐시 시점과 현재의 도장을 비교 — 결과는 루트 상대 경로. */
export function diffStamps(cached: readonly StampRow[], current: readonly StampRow[]): { changed: string[]; removed: string[] } {
  const before = new Map(cached.map(([rel, mtimeMs, size]) => [rel, `${mtimeMs}:${size}`] as const));
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const [rel, mtimeMs, size] of current) {
    seen.add(rel);
    if (before.get(rel) !== `${mtimeMs}:${size}`) changed.push(rel);
  }
  return { changed, removed: cached.map(([rel]) => rel).filter(rel => !seen.has(rel)) };
}

/** 파일별 목록을 평평한 배열로 — 빈 목록은 담지 않는다. */
export function packRows<T>(byFile: Iterable<[number, readonly T[]]>, row: (e: T) => (string | number)[]): (string | number)[] {
  const out: (string | number)[] = [];
  for (const [fileIdx, list] of byFile) {
    if (!list.length) continue;
    out.push(fileIdx, list.length);
    for (const e of list) out.push(...row(e));
  }
  return out;
}

/** 손상되거나 조작된 배열도 안전하게 읽는다 — 개수·인덱스를 믿지 않고, 셀이 모자라면 그 묶음을 버린다. */
export function unpackRows(flat: readonly (string | number)[], width: number,
                          apply: (fileIdx: number, row: readonly (string | number)[]) => void): void {
  let i = 0;
  while (i + 1 < flat.length) {
    const fileIdx = flat[i++];
    const n = flat[i++];
    if (!isIndex(fileIdx) || !isIndex(n) || i + width * n > flat.length) return;
    for (let k = 0; k < n; k++) { apply(fileIdx, flat.slice(i, i + width)); i += width; }
  }
}

function isIndex(value: string | number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
