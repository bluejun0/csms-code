import { SourceLocation } from '../../shared/value-objects';
export interface TemplateRepository {
  locationsOf(component: string, name: string): SourceLocation[];
  has(component: string, name: string): boolean;
}
