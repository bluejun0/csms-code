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
