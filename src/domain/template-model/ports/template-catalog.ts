import { SourceLocation } from '../../shared/value-objects';

/** 플러그인 탐색기용 열거. */
export interface TemplateCatalog {
  components(): string[];
  namesOf(component: string): string[];
  locationsOf(component: string, name: string): SourceLocation[];
}
