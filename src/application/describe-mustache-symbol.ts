import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { canonicalComponent } from './canonical-component';
import { itemWithKeyAt } from '../domain/code-analysis/key-at';
import { parseModuleRef } from '../domain/shared/module-ref';
import { scanMustache } from '../domain/code-analysis/mustache-scanner';
import { HoverResult } from './dto';

/** `.mustache` hover — 문자열 키는 한국어·영어 값, 템플릿 참조는 해석되는 파일 수. */
export class DescribeMustacheSymbol {
  constructor(private templates: TemplateRepository, private strings: StringRepository) {}

  run(text: string, atIndex: number): HoverResult | null {
    const refs = scanMustache(text);
    const s = itemWithKeyAt(refs.stringRefs, atIndex);
    if (s) {
      const component = canonicalComponent(this.strings, s.component);
      const found = this.strings.getString(component, s.key);
      if (!found) return null;
      const parts = [`**${component}/${s.key}**`];
      if (found.ko) parts.push(found.ko.value);
      if (found.en) parts.push(`en: ${found.en.value}`);
      return { markdown: parts.join('\n\n'), target: { component, key: s.key } };
    }
    const t = refs.templateRefs.find(r => r.index <= atIndex && atIndex <= r.index + r.ref.length);
    if (!t) return null;
    const ref = parseModuleRef(t.ref);
    if (!ref) return null;
    const locs = this.templates.locationsOf(ref.component, ref.name);
    if (!locs.length) return null;
    const head = `**${t.ref}**`;
    return { markdown: locs.length > 1 ? `${head}\n\n오버라이드 포함 ${locs.length}곳` : head };
  }
}
