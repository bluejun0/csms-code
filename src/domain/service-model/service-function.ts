import { SourceLocation } from '../shared/value-objects';

/** `db/services.php`의 `$functions` 항목 하나 — 웹서비스로 노출된 외부 함수. */
export interface ServiceFunction {
  name: string;
  component: string;
  classname: string;
  methodname: string;
  description: string;
  type: string;
  location: SourceLocation;
}
