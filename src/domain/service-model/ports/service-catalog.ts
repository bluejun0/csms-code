import { ServiceFunction } from '../service-function';

/** 플러그인 탐색기용 열거. */
export interface ServiceCatalog {
  components(): string[];
  functionsOf(component: string): ServiceFunction[];
}
