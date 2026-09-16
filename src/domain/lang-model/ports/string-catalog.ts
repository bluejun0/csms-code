import { LangString } from '../lang-string';

/** 플러그인 탐색기용 열거. */
export interface StringCatalog {
  components(): string[];
  keysOf(component: string): LangString[];
}
