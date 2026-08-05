import { StringUsageRepository } from '../domain/lang-model/ports/string-usage-repository';
import { SourceLocation } from '../domain/shared/value-objects';

export class FindStringReferences {
  constructor(private usages: StringUsageRepository) {}
  run(component: string, key: string): SourceLocation[] {
    return this.usages.referencesOf(component, key);
  }
}
