import { ConfigCall, DocumentFacts } from '../domain/code-analysis/facts';
import { resolveComponentRef } from '../domain/lang-model/services/component-propagation';
import { itemWithKeyAt } from '../domain/code-analysis/key-at';

/** 설정 호출 전부 — 리터럴 플러그인 호출과, 리터럴로 해석되는 동적 플러그인 호출.
 *  정의 이동·hover·하이라이트·참조가 모두 이 목록만 보므로 규칙이 갈라질 수 없다. 해석되지 않는 동적 호출은 없다(침묵). */
export function allConfigCalls(facts: DocumentFacts): ConfigCall[] {
  const out: ConfigCall[] = [...facts.configCalls];
  for (const call of facts.dynamicConfigCalls) {
    const plugin = resolveComponentRef(facts, call);
    if (plugin === null) continue;
    out.push({
      plugin, key: call.key, kind: call.kind,
      keyLine: call.keyLine, keyColumn: call.keyColumn, keyIndex: call.keyIndex, index: call.index,
    });
  }
  return out;
}

/** 커서가 설정 호출의 key 리터럴 내용 범위 안에 있는 호출 */
export function findConfigCallAt(facts: DocumentFacts, atIndex: number): ConfigCall | undefined {
  return itemWithKeyAt(allConfigCalls(facts), atIndex);
}
