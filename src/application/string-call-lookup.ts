import { DocumentFacts, StringCall } from '../domain/code-analysis/facts';
import { resolveComponentRef } from '../domain/lang-model/services/component-propagation';

/** 문자열 호출 전부 — 리터럴 컴포넌트 호출과, 리터럴로 해석되는 동적 컴포넌트 호출.
 *  네 기능(정의 이동·hover·하이라이트·진단)이 모두 이 목록만 보므로 규칙이 갈라질 수 없다.
 *  해석되지 않는 동적 호출은 목록에 없다(침묵). */
export function allStringCalls(facts: DocumentFacts): StringCall[] {
  const out: StringCall[] = [...facts.stringCalls];
  for (const call of facts.dynamicStringCalls) {
    const component = resolveComponentRef(facts, call);
    if (component === null) continue;
    out.push({
      key: call.key, component,
      keyLine: call.keyLine, keyColumn: call.keyColumn, keyIndex: call.keyIndex,
      index: call.index,
    });
  }
  return out;
}

/** 커서가 get_string의 key 리터럴 내용 범위 안에 있는 호출 */
export function findStringCallAt(facts: DocumentFacts, atIndex: number): StringCall | undefined {
  return allStringCalls(facts).find(c => c.keyIndex <= atIndex && atIndex <= c.keyIndex + c.key.length);
}
