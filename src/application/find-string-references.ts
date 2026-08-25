import { StringUsageRepository } from '../domain/lang-model/ports/string-usage-repository';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { SourceLocation } from '../domain/shared/value-objects';

/** canonical (component, key)의 사용처. `includeDeclaration`이면 lang 정의(ko·en)도 함께 넣는다 —
 *  코드 쪽에서 참조를 찾을 때 선언도 함께 보이는 관례를 따른다(표시 순서는 편집기가 정한다). */
export class FindStringReferences {
  constructor(private usages: StringUsageRepository, private strings: StringRepository) {}
  run(component: string, key: string, includeDeclaration = false): SourceLocation[] {
    const out: SourceLocation[] = [];
    if (includeDeclaration) {
      const s = this.strings.getString(component, key);
      if (s?.ko) out.push(s.ko.location);
      if (s?.en) out.push(s.en.location);
    }
    out.push(...this.usages.referencesOf(component, key));
    return out;
  }
}
