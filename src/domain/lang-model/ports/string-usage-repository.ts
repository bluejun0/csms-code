import { SourceLocation } from '../../shared/value-objects';
export interface StringUsageRepository {
  referencesOf(component: string, key: string): SourceLocation[];
}
