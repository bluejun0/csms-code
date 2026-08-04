import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RecordTypeInference } from '../domain/code-analysis/record-type-inference';
import { ColumnItem } from './dto';
import { DocumentFacts, Scope } from '../domain/code-analysis/facts';

export class CompleteRecordColumns {
  constructor(private syntax: PhpSyntax, private tables: TableRepository, private inference: RecordTypeInference) {}
  run(text: string, varName: string, atIndex: number): ColumnItem[] {
    const facts = this.syntax.facts(text);
    const exists = (t: string) => this.tables.getTable(t) !== undefined;
    const scope = scopeContaining(facts, atIndex);
    const binding = this.inference.infer(facts, varName, atIndex, scope, exists);
    if (!binding) return [];
    const table = this.tables.getTable(binding.tableName);
    if (!table) return [];
    return table.fields.map(f => ({ name: f.name, type: f.type, comment: f.comment }));
  }
}
// 커서 위치를 포함하는 가장 좁은 팩트 스코프(없으면 전체).
// DocumentFacts 전체에서 구조적으로 유도 — 새 팩트 종류가 추가돼도 자동 포함(수기 열거가 백로그 11번 버그의 원인).
function scopeContaining(facts: DocumentFacts, atIndex: number): Scope {
  let best: Scope = { start: 0, end: Number.MAX_SAFE_INTEGER };
  const all = (Object.values(facts).flat() as unknown[])
    .filter((x): x is { scope: Scope } => !!x && typeof x === 'object' && 'scope' in x);
  for (const { scope } of all)
    if (scope.start <= atIndex && atIndex <= scope.end && (scope.end - scope.start) < (best.end - best.start)) best = scope;
  return best;
}
