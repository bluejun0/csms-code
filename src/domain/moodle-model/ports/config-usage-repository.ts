import { SourceLocation } from '../../shared/value-objects';

export interface ConfigUsageRepository {
  configRefsOf(plugin: string, key: string): SourceLocation[];
}
