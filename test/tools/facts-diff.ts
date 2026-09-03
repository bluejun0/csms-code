import * as fs from 'fs';
import { DocumentFacts } from '../../src/domain/code-analysis/facts';
import { PhpSyntax } from '../../src/domain/code-analysis/ports/php-syntax';

export type FactKind = keyof DocumentFacts;

export interface FactDifference { kind: FactKind; onlyInA: string[]; onlyInB: string[] }

// JSON.stringify의 replacer 배열은 모든 깊이에서 같은 키 목록만 남긴다 —
// 최상위 키만 넘기면 중첩된 scope가 {}로 지워져 스코프 차이가 diff에 안 잡힌다.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function multiset(list: readonly unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of list) {
    const key = canonical(item);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function surplus(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [key, count] of a) {
    const extra = count - (b.get(key) ?? 0);
    for (let i = 0; i < extra; i++) out.push(key);
  }
  return out;
}

export function diffFacts(a: DocumentFacts, b: DocumentFacts): FactDifference[] {
  const out: FactDifference[] = [];
  for (const kind of Object.keys(a) as FactKind[]) {
    const left = multiset(a[kind]);
    const right = multiset(b[kind]);
    const onlyInA = surplus(left, right);
    const onlyInB = surplus(right, left);
    if (onlyInA.length || onlyInB.length) out.push({ kind, onlyInA, onlyInB });
  }
  return out;
}

/** compareOverFiles가 실제로 몇 개를 비교했는지 — 읽기 실패로 조용히 빠진 파일 수를
 *  드러내지 않으면 "2000개 비교"라는 주장이 사실은 "1990개만 비교"일 수 있다. */
export interface CompareStats { compared: number; skipped: number; }

export function compareOverFilesDetailed(
  a: PhpSyntax, b: PhpSyntax, files: readonly string[],
): { differences: Map<string, FactDifference[]>; stats: CompareStats } {
  const differences = new Map<string, FactDifference[]>();
  let compared = 0, skipped = 0;
  for (const file of files) {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { skipped++; continue; }
    compared++;
    const diff = diffFacts(a.facts(text), b.facts(text));
    if (diff.length) differences.set(file, diff);
  }
  return { differences, stats: { compared, skipped } };
}

export function compareOverFiles(a: PhpSyntax, b: PhpSyntax, files: readonly string[]): Map<string, FactDifference[]> {
  return compareOverFilesDetailed(a, b, files).differences;
}
