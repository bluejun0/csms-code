import { AmdUsageRepository } from '../domain/amd-model/ports/amd-usage-repository';
import { SourceLocation } from '../domain/shared/value-objects';

export class FindAmdReferences {
  constructor(private usages: AmdUsageRepository) {}
  run(component: string, name: string): SourceLocation[] {
    return this.usages.amdRefsOf(component, name);
  }
}
