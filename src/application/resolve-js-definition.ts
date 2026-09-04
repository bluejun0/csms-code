import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { scanJsCalls } from '../domain/code-analysis/js-call-scanner';
import { itemWithKeyAt } from '../domain/code-analysis/key-at';
import { DefinitionResult } from './dto';

/** JS 파일에서 커서가 놓인 리터럴(문자열 키 또는 템플릿 ref)의 정의 위치 */
export class ResolveJsDefinition {
  constructor(private strings: StringRepository, private templates: TemplateRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const calls = scanJsCalls(text);
    const s = itemWithKeyAt(calls.stringCalls, atIndex);
    if (s) {
      const found = this.strings.getString(s.component, s.key);
      if (!found) return [];
      const origin = { line: s.keyLine, column0: s.keyColumn, length: s.key.length };
      const out: DefinitionResult[] = [];
      if (found.ko) out.push({ location: found.ko.location, origin });
      if (found.en) out.push({ location: found.en.location, origin });
      return out;
    }
    const t = calls.templateCalls.find(c => c.refIndex <= atIndex && atIndex <= c.refIndex + c.ref.length);
    if (!t) return [];
    const ref = parseTemplateRef(t.ref);
    if (!ref) return [];
    const origin = { line: t.refLine, column0: t.refColumn, length: t.ref.length };
    return this.templates.locationsOf(ref.component, ref.name).map(location => ({ location, origin }));
  }
}
