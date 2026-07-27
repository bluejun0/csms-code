import { DocumentFacts, Scope } from './facts';

export type BindingSource = 'phpdoc' | 'assignment' | 'foreach' | 'dataarg';
export interface RecordBinding { varName: string; tableName: string; source: BindingSource; }

const RECORD_METHODS = new Set([
  'get_record', 'get_record_select', 'get_records', 'get_records_select',
  'get_recordset', 'get_recordset_select',
]);

function sameScope(a: Scope, b: Scope): boolean { return a.start === b.start && a.end === b.end; }

export class RecordTypeInference {
  infer(facts: DocumentFacts, varName: string, atIndex: number, scope: Scope,
        tableExists: (t: string) => boolean): RecordBinding | null {

    // ① phpdoc: 타입 텍스트가 실존 테이블명으로 해석되면 우선
    const doc = nearestPreceding(
      facts.phpdocVars.filter(v => v.varName === varName && sameScope(v.scope, scope)), atIndex);
    if (doc) {
      const t = stripType(doc.typeText);
      if (tableExists(t)) return { varName, tableName: t, source: 'phpdoc' };
      // bare stdClass 등 → 폴백(아래로)
    }

    // ② 직전 대입: RECORD_METHODS + 리터럴 테이블
    const asg = nearestPreceding(
      facts.assignments.filter(a => a.varName === varName && sameScope(a.scope, scope)
        && RECORD_METHODS.has(a.method) && a.tableArg && tableExists(a.tableArg)), atIndex);
    if (asg) return { varName, tableName: asg.tableArg!, source: 'assignment' };

    // ③ foreach: 항목 변수 → 컬렉션의 테이블
    const fe = nearestPreceding(
      facts.foreachBindings.filter(b => b.itemVar === varName && sameScope(b.scope, scope)), atIndex);
    if (fe) {
      const coll = nearestPreceding(
        facts.assignments.filter(a => a.varName === fe.collectionVar && sameScope(a.scope, scope)
          && RECORD_METHODS.has(a.method) && a.tableArg && tableExists(a.tableArg)), fe.index);
      if (coll) return { varName, tableName: coll.tableArg!, source: 'foreach' };
    }

    // ④ dataarg: 스코프 전역(insert/update 의 data 인자)
    // 동일 변수명이 서로 다른 테이블에 바인딩되면(예: install/upgrade 스크립트에서
    // $data 를 재사용) 어느 쪽인지 확신할 수 없으므로 null(오탐 방지) — 단일 테이블로
    // 귀결될 때만 바인딩.
    const daMatches = facts.dataArgBindings.filter(d =>
      d.dataVar === varName && sameScope(d.scope, scope) && tableExists(d.tableArg));
    if (daMatches.length > 0) {
      const distinctTables = new Set(daMatches.map(d => d.tableArg));
      if (distinctTables.size === 1) return { varName, tableName: daMatches[0].tableArg, source: 'dataarg' };
      return null;
    }

    return null;
  }
}

function nearestPreceding<T extends { index: number }>(items: T[], atIndex: number): T | undefined {
  let best: T | undefined;
  for (const it of items) if (it.index <= atIndex && (!best || it.index > best.index)) best = it;
  return best;
}

/** `\stdClass` / `stdClass` / `?table` 등에서 마지막 식별자만 */
function stripType(t: string): string {
  return t.replace(/^[?\\]+/, '').split('\\').pop() ?? t;
}
