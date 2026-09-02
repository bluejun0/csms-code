import { SourceLocation } from '../../shared/value-objects';

export interface TableUsageRepository {
  tableRefsOf(name: string): SourceLocation[];
}
