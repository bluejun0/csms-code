import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { DefinitionResult } from './dto';

export class ResolveTemplateDefinition {
  constructor(private syntax: PhpSyntax, private templates: TemplateRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const call = this.syntax.facts(text).templateCalls
      .find(c => c.refIndex <= atIndex && atIndex <= c.refIndex + c.ref.length);
    if (!call) return [];
    const ref = parseTemplateRef(call.ref);
    if (!ref) return [];
    return this.templates.locationsOf(ref.component, ref.name).map(location => ({ location }));
  }
}
