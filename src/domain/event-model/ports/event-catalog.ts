import { EventDefinition } from '../event-definition';

/** 플러그인 탐색기용 열거. */
export interface EventCatalog {
  components(): string[];
  eventsOf(component: string): EventDefinition[];
}
