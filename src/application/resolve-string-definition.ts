import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { DefinitionResult } from './dto';
import { findStringCallAt } from './string-call-lookup';

export class ResolveStringDefinition {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const call = findStringCallAt(this.syntax.facts(text), atIndex);
    if (!call) return [];
    const s = this.strings.getString(call.component, call.key);
    if (!s) return [];
    const out: DefinitionResult[] = [];
    if (s.ko) out.push({ location: s.ko.location });
    if (s.en) out.push({ location: s.en.location });
    return out;
  }
}
