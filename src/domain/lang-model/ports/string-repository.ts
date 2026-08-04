import { LangString } from '../lang-string';

export interface StringRepository {
  getString(component: string, key: string): LangString | undefined;
  keysOf(component: string): LangString[];
  hasComponent(component: string): boolean;
}
