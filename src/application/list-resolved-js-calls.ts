import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { scanJsCalls } from '../domain/code-analysis/js-call-scanner';
import { RangeItem } from './dto';

/** 색인에 존재하는 JS 참조의 범위 — 하이라이트용. 설정이 문자열/템플릿으로 나뉘므로 종류별로 나눠 제공한다. */
export class ListResolvedJsCalls {
  constructor(private strings: StringRepository, private templates: TemplateRepository) {}

  /** 문자열 키 범위만 */
  runStrings(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const c of scanJsCalls(text).stringCalls) {
      if (!this.strings.getString(c.component, c.key)) continue;
      out.push({ line: c.keyLine, column0: c.keyColumn, length: c.key.length });
    }
    return out;
  }

  /** 템플릿 ref 범위만 */
  runTemplates(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const c of scanJsCalls(text).templateCalls) {
      const ref = parseTemplateRef(c.ref);
      if (!ref || !this.templates.has(ref.component, ref.name)) continue;
      out.push({ line: c.refLine, column0: c.refColumn, length: c.ref.length });
    }
    return out;
  }

  /** 둘 다 — 기존 호출부 호환 */
  run(text: string): RangeItem[] {
    return [...this.runStrings(text), ...this.runTemplates(text)];
  }
}
