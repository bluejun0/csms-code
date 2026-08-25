import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { canonicalComponent } from './canonical-component';
import { parseModuleRef } from '../domain/shared/module-ref';
import { scanMustache } from '../domain/code-analysis/mustache-scanner';
import { RangeItem } from './dto';

/** 해석되는 참조의 범위 — 템플릿과 문자열을 따로 준다(설정이 각각이다). */
export class ListResolvedMustacheRefs {
  constructor(private templates: TemplateRepository, private strings: StringRepository) {}

  runTemplates(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const t of scanMustache(text).templateRefs) {
      const ref = parseModuleRef(t.ref);
      if (!ref || !this.templates.has(ref.component, ref.name)) continue;
      out.push({ line: t.line, column0: t.column, length: t.ref.length });
    }
    return out;
  }

  runStrings(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const s of scanMustache(text).stringRefs) {
      const component = canonicalComponent(this.strings, s.component);
      if (!this.strings.getString(component, s.key)) continue;
      out.push({ line: s.keyLine, column0: s.keyColumn, length: s.key.length });
    }
    return out;
  }
}
