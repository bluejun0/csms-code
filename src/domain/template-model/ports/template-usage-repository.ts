import { SourceLocation } from '../../shared/value-objects';
export interface TemplateUsageRepository {
  templateRefsOf(component: string, name: string): SourceLocation[];
}
