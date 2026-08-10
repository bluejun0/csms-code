import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { normalizeComponent } from '../domain/lang-model/services/component-normalizer';
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
      return this.templates.locationsOf(ref.component, ref.name).map(location => ({ location }));
    }
    const s = refs.stringRefs.find(r => r.keyIndex <= atIndex && atIndex <= r.keyIndex + r.key.length);
    if (!s) return [];
    const component = normalizeComponent(s.component, c => this.strings.hasComponent(c));
    const found = this.strings.getString(component, s.key);
    if (!found) return [];
    const out: DefinitionResult[] = [];
    if (found.ko) out.push({ location: found.ko.location });
    if (found.en) out.push({ location: found.en.location });
    return out;
  }
}
