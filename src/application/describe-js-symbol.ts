import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { scanJsCalls } from '../domain/code-analysis/js-call-scanner';
import { HoverResult } from './dto';
import { canonicalComponent } from './canonical-component';
import { itemWithKeyAt } from '../domain/code-analysis/key-at';

export class DescribeJsSymbol {
  constructor(private strings: StringRepository, private templates: TemplateRepository) {}
  run(text: string, atIndex: number): HoverResult | null {
    const calls = scanJsCalls(text);
    const s = itemWithKeyAt(calls.stringCalls, atIndex);
    if (s) {
      const found = this.strings.getString(s.component, s.key);
      if (!found) return null;
      const parts = [`**${s.component} / ${s.key}**`];
      if (found.ko) parts.push(`ko: ${found.ko.value}`);
      if (found.en) parts.push(`en: ${found.en.value}`);
      const component = canonicalComponent(this.strings, s.component);
      return { markdown: parts.join('\n\n'), target: { component, key: s.key } };
    }
    const t = calls.templateCalls.find(c => c.refIndex <= atIndex && atIndex <= c.refIndex + c.ref.length);
    if (!t) return null;
    const ref = parseTemplateRef(t.ref);
    if (!ref) return null;
    const locs = this.templates.locationsOf(ref.component, ref.name);
    if (!locs.length) return null;
    return { markdown: [`**${ref.component} / ${ref.name}**`, ...locs.map(l => l.uri)].join('\n\n') };
  }
}
