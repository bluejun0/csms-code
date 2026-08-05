import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { RangeItem } from './dto';

/** 색인에 존재하는 템플릿 참조의 범위 — 하이라이트용 */
export class ListResolvedTemplateCalls {
  constructor(private syntax: PhpSyntax, private templates: TemplateRepository) {}
  run(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const c of this.syntax.facts(text).templateCalls) {
      const ref = parseTemplateRef(c.ref);
      if (!ref || !this.templates.has(ref.component, ref.name)) continue;
      out.push({ line: c.refLine, column0: c.refColumn, length: c.ref.length });
    }
    return out;
  }
}
