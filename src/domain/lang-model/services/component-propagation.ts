import { ComponentRef, DocumentFacts, DynamicStringCall, Scope } from '../../code-analysis/facts';

/** 컴포넌트 인자를 같은 파일의 문자열 리터럴로 한 단계 거슬러 올라가 해석한다.
 *  서로 다른 리터럴이 둘 이상이면 null — 틀린 컴포넌트로 해석하면 누락 키 진단이 곧 오탐이 된다. */
export function resolveComponentRef(facts: DocumentFacts, call: DynamicStringCall): string | null {
  switch (call.comp.kind) {
    case 'var': return single(facts.literalAssignments
      .filter(a => a.varName === call.comp.name && sameScope(a.scope, call.scope))
      .map(a => a.value));
    case 'prop': return single(facts.propertyLiterals
      .filter(p => p.property === call.comp.name).map(p => p.value));
    case 'const': return single(facts.constLiterals
      .filter(c => c.name === call.comp.name).map(c => c.value));
  }
}

/** 값이 하나로 귀결될 때만 그 값 */
function single(values: string[]): string | null {
  const distinct = new Set(values);
  return distinct.size === 1 ? [...distinct][0] : null;
}

function sameScope(a: Scope, b: Scope): boolean { return a.start === b.start && a.end === b.end; }

/** 참조 형태를 사람이 읽을 문자열로 — hover·문서에서 쓴다. */
export function describeComponentRef(ref: ComponentRef): string {
  return ref.kind === 'var' ? `$${ref.name}`
    : ref.kind === 'prop' ? `$this->${ref.name}`
      : `::${ref.name}`;
}
