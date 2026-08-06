import { DocumentFacts, ForeachBinding, Scope } from './facts';

export type BindingSource = 'phpdoc' | 'assignment' | 'foreach' | 'dataarg';
export interface RecordBinding { varName: string; tableName: string; source: BindingSource; }

// 단일 stdClass 레코드 반환 → 변수 자체에 컬럼 바인딩 (② 직접 대입 경로)
const DIRECT_RECORD_METHODS = new Set(['get_record', 'get_record_select']);
// 레코드 컬렉션 반환 → foreach 항목 변수에만 바인딩 — 배열/recordset 변수 자체는 레코드가 아니다.
const COLLECTION_METHODS = new Set(['get_records', 'get_records_select', 'get_recordset', 'get_recordset_select']);

function sameScope(a: Scope, b: Scope): boolean { return a.start === b.start && a.end === b.end; }

export class RecordTypeInference {
  infer(facts: DocumentFacts, varName: string, atIndex: number, scope: Scope,
        tableExists: (t: string) => boolean): RecordBinding | null {

    // ① phpdoc: 절대 우선 — 오탐 회피 수단(@var)이 자기 다음 대입에 죽지 않도록 위치 비교에 불참
    const doc = nearestPreceding(
      facts.phpdocVars.filter(v => v.varName === varName && sameScope(v.scope, scope)), atIndex);
    if (doc) {
      const t = stripType(doc.typeText);
      if (tableExists(t)) return { varName, tableName: t, source: 'phpdoc' };
      // bare stdClass 등 → 폴백(아래로)
    }

    // kill 기준: 종류 무관 가장 가까운 일반 대입 — 이보다 오래된 바인딩 이벤트는 죽는다
    const kill = nearestPreceding(
      facts.plainAssignments.filter(p => p.varName === varName && sameScope(p.scope, scope)), atIndex);

    // ②+③ 병합: 레코드 대입 vs foreach 중 더 가까운 이벤트가 승리
    const asg = nearestPreceding(
      facts.assignments.filter(a => a.varName === varName && sameScope(a.scope, scope)
        && DIRECT_RECORD_METHODS.has(a.method) && a.tableArg && tableExists(a.tableArg)), atIndex);
    const fe = nearestPreceding(
      facts.foreachBindings.filter(b => b.itemVar === varName && sameScope(b.scope, scope)), atIndex);

    if (asg && (!fe || asg.index > fe.index)) {
      // 레코드 대입은 자신도 일반 대입(같은 index)이므로 >= 로 자연 통과
      if (!kill || asg.index >= kill.index) {
        return { varName, tableName: asg.tableArg!, source: 'assignment' };
      }
    } else if (fe && (!kill || fe.index >= kill.index)) {
      const table = resolveCollection(facts, fe, scope, tableExists);
      if (table) return { varName, tableName: table, source: 'foreach' };
    }

    // ④ dataarg: 스코프 전역 유지 — $data = new stdClass(); … insert_record('tbl', $data)
    // 패턴에서 new stdClass 대입이 kill이어도 dataarg가 되살리는 것이 의도된 동작.
    // 동일 변수명이 서로 다른 테이블에 바인딩되면 null(오탐 방지) — 단일 테이블로 귀결될 때만 바인딩.
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

/** foreach 컬렉션 변수를 fe 시점 기준으로 해석 — 컬렉션 변수에도 동일한 kill 가드 적용 */
function resolveCollection(facts: DocumentFacts, fe: ForeachBinding, scope: Scope,
                           tableExists: (t: string) => boolean): string | null {
  const collAsg = nearestPreceding(
    facts.assignments.filter(a => a.varName === fe.collectionVar && sameScope(a.scope, scope)
      && COLLECTION_METHODS.has(a.method) && a.tableArg && tableExists(a.tableArg)), fe.index);
  if (!collAsg) return null;
  const collKill = nearestPreceding(
    facts.plainAssignments.filter(p => p.varName === fe.collectionVar && sameScope(p.scope, scope)), fe.index);
  if (collKill && collKill.index > collAsg.index) return null;
  return collAsg.tableArg!;
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
