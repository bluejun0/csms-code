import { DocumentFacts, Scope } from '../domain/code-analysis/facts';
import { GlobalBinding, MOODLE_GLOBALS } from '../domain/moodle-model/globals';

export interface GlobalHit { varName: string; member: string; binding: GlobalBinding; }

/** 커서가 짚은 전역 멤버 — 프로퍼티 접근과 메서드 호출 양쪽을 본다. */
export function globalMemberAt(facts: DocumentFacts, atIndex: number): GlobalHit | null {
  const pa = facts.propertyAccesses
    .find(p => p.propIndex <= atIndex && atIndex <= p.propIndex + p.property.length);
  if (pa) {
    const binding = MOODLE_GLOBALS[pa.varName];
    if (binding && !shadowed(facts, pa.varName, pa.index, binding)) {
      return { varName: pa.varName, member: pa.property, binding };
    }
  }
  const mc = facts.methodCalls
    .find(c => c.nameIndex <= atIndex && atIndex <= c.nameIndex + c.method.length);
  if (mc) {
    const binding = MOODLE_GLOBALS[mc.varName];
    if (binding && !shadowed(facts, mc.varName, mc.index, binding)) {
      return { varName: mc.varName, member: mc.method, binding };
    }
  }
  return null;
}

/** 테이블 전역은 지역 변수로 가려질 수 있다(`foreach ($users as $USER)`, 재대입).
 *  같은 스코프의 선행 대입이 있으면 전역이 아니라 레코드 엔진이 담당한다.
 *  클래스·설정 전역은 실코드에서 재대입되지 않고, 되더라도 줄 후보가 달라지지 않아 판정하지 않는다. */
export function shadowed(facts: DocumentFacts, varName: string, atIndex: number,
                         binding: GlobalBinding): boolean {
  if (binding.kind !== 'table') return false;
  const scope = scopeContaining(facts, atIndex);
  const assigned = facts.plainAssignments
    .some(p => p.varName === varName && sameScope(p.scope, scope) && p.index <= atIndex);
  const bound = facts.foreachBindings
    .some(b => b.itemVar === varName && sameScope(b.scope, scope) && b.index <= atIndex);
  // `$DB->update_record('user', $USER)`는 레코드 엔진이 같은 컬럼을 이미 준다 —
  // 두 경로가 함께 답하면 목록이 그대로 두 번 나온다.
  const dataArg = facts.dataArgBindings
    .some(d => d.dataVar === varName && sameScope(d.scope, scope));
  return assigned || bound || dataArg;
}

function sameScope(a: Scope, b: Scope): boolean { return a.start === b.start && a.end === b.end; }

/** 커서를 포함하는 가장 좁은 팩트 스코프(없으면 전체). */
export function scopeContaining(facts: DocumentFacts, atIndex: number): Scope {
  let best: Scope = { start: 0, end: Number.MAX_SAFE_INTEGER };
  const all = (Object.values(facts).flat() as unknown[])
    .filter((x): x is { scope: Scope } => !!x && typeof x === 'object' && 'scope' in x);
  for (const { scope } of all)
    if (scope.start <= atIndex && atIndex <= scope.end && (scope.end - scope.start) < (best.end - best.start)) best = scope;
  return best;
}
