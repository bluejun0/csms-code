import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { normalizeComponent } from '../domain/lang-model/services/component-normalizer';

/** 호출에 적힌 컴포넌트를 색인이 쓰는 canonical 이름으로.
 *  사용처 색인은 삽입 시 같은 규칙으로 정규화하므로, raw 이름으로 조회하면 정의 이동은 되는데 참조만 조용히 빈다. */
export function canonicalComponent(strings: StringRepository, raw: string): string {
  return normalizeComponent(raw, c => strings.hasComponent(c));
}
