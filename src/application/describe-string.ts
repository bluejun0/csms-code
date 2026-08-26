import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { HoverResult } from './dto';
import { canonicalComponent } from './canonical-component';
import { findStringCallAt } from './string-call-lookup';

export class DescribeString {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string, atIndex: number): HoverResult | null {
    const call = findStringCallAt(this.syntax.facts(text), atIndex);
    if (!call) return null;
    const s = this.strings.getString(call.component, call.key);
    if (!s) return null;
    const parts = [`**${call.component} / ${call.key}**`];
    if (s.ko) parts.push(`ko: ${s.ko.value}`);
    if (s.en) parts.push(`en: ${s.en.value}`);
    const component = canonicalComponent(this.strings, call.component);
    return { markdown: parts.join('\n\n'), target: { kind: 'string', component, key: call.key } };
  }
}
