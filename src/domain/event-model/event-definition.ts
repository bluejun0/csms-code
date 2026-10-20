import { SourceLocation } from '../shared/value-objects';

/** `classes/event/*.php`에 선언된 이벤트 클래스 하나. */
export interface EventDefinition {
  /** `db/events.php`의 `eventname`에 적는 꼴(`\local_x\event\thing_done`). */
  name: string;
  shortName: string;
  component: string;
  /** `init()`의 `$this->data['crud']` — 상속받아 직접 적지 않으면 빈 문자열. */
  crud: string;
  /** `get_name()`이 돌려주는 이름 — `get_string` 인자(적힌 그대로의 컴포넌트)이거나 리터럴. */
  title: EventTitle | null;
  location: SourceLocation;
}

export type EventTitle = { key: string; component: string } | { text: string };
