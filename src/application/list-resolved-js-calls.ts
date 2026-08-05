import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { scanJsCalls } from '../domain/code-analysis/js-call-scanner';
import { RangeItem } from './dto';

/** 색인에 존재하는 JS 참조(문자열 키·템플릿 ref)의 범위 — 하이라이트용 */
export class ListResolvedJsCalls {
  constructor(private strings: StringRepository, private templates: TemplateRepository) {}
  run(text: string): RangeItem[] {
    const calls = scanJsCalls(text);
    const out: RangeItem[] = [];
    for (const c of calls.stringCalls) {
      if (!this.strings.getString(c.component, c.key)) continue;
      out.push({ line: c.keyLine, column0: c.keyColumn, length: c.key.length });
    }
    for (const c of calls.templateCalls) {
      const ref = parseTemplateRef(c.ref);
      if (!ref || !this.templates.has(ref.component, ref.name)) continue;
      out.push({ line: c.refLine, column0: c.refColumn, length: c.ref.length });
    }
    return out;
  }
}
