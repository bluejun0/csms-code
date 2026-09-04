import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { canonicalComponent } from './canonical-component';
import { itemWithKeyAt } from '../domain/code-analysis/key-at';
import { parseModuleRef } from '../domain/shared/module-ref';
import { scanMustache } from '../domain/code-analysis/mustache-scanner';
import { DefinitionResult } from './dto';

/** `.mustache` 안에서 F12 — partial·parent는 그 템플릿 파일로, `{{#str}}` 키는 lang 파일로. */
export class ResolveMustacheDefinition {
  constructor(private templates: TemplateRepository, private strings: StringRepository) {}

  run(text: string, atIndex: number): DefinitionResult[] {
    const refs = scanMustache(text);
    const t = refs.templateRefs.find(r => r.index <= atIndex && atIndex <= r.index + r.ref.length);
    if (t) {
      const ref = parseModuleRef(t.ref);
      if (!ref) return [];
      const origin = { line: t.line, column0: t.column, length: t.ref.length };
      return this.templates.locationsOf(ref.component, ref.name).map(location => ({ location, origin }));
    }
    const s = itemWithKeyAt(refs.stringRefs, atIndex);
    if (!s) return [];
    const component = canonicalComponent(this.strings, s.component);
    const found = this.strings.getString(component, s.key);
    if (!found) return [];
    const origin = { line: s.keyLine, column0: s.keyColumn, length: s.key.length };
    const out: DefinitionResult[] = [];
    if (found.ko) out.push({ location: found.ko.location, origin });
    if (found.en) out.push({ location: found.en.location, origin });
    return out;
  }
}
