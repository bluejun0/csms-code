import { DocumentFacts, FactKind, Scope } from '../../domain/code-analysis/facts';

export type { FactKind };

export interface Captures {
  has(name: string): boolean;
  text(name: string): string;
  index(name: string): number;
  line(name: string): number;
  column(name: string): number;
  scope(name: string): Scope;
  lastNameIn(name: string): string | null;
}

export interface FactSink {
  add<K extends FactKind>(kind: K, fact: DocumentFacts[K][number]): void;
}

export interface QueryFragment {
  readonly produces: readonly FactKind[];
  readonly pattern: string;
  collect(at: Captures, into: FactSink): void;
}

// tree-sitter 쿼리 문법 기준: `;`는 줄 끝까지 주석, `"`는 그 안에서 괄호를 세지 않는 문자열을 열고,
// `\`는 다음 한 글자를 이스케이프하며, 최상위 `[...]` 대안은 그 전체가 패턴 하나다.
export function topLevelPatternCount(pattern: string): number {
  let depth = 0;
  let count = 0;
  let inString = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === ';') {
      while (i < pattern.length && pattern[i] !== '\n') i++;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '(' || ch === '[') { if (depth === 0) count++; depth++; }
    else if (ch === ')' || ch === ']') depth--;
  }
  return count;
}
