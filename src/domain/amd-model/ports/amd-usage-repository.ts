import { SourceLocation } from '../../shared/value-objects';

export interface AmdUsageRepository {
  amdRefsOf(component: string, name: string): SourceLocation[];
}
