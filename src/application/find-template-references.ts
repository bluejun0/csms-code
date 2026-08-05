import { TemplateUsageRepository } from '../domain/template-model/ports/template-usage-repository';
import { SourceLocation } from '../domain/shared/value-objects';

export class FindTemplateReferences {
  constructor(private usages: TemplateUsageRepository) {}
  run(component: string, name: string): SourceLocation[] {
    return this.usages.templateRefsOf(component, name);
  }
}
