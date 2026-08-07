/** Moodle 스크립트 최상단의 `global $DB, $CFG, …` 전역이 무엇으로 해석되는지.
 *  `global` 선언 자체에는 타입 정보가 없어 코드에서 유도할 수 없다 — Moodle 관례를 표로 둔다. */
export type GlobalBinding =
  | { kind: 'class'; className: string }
  | { kind: 'table'; tableName: string }
  | { kind: 'config' };

export const MOODLE_GLOBALS: Record<string, GlobalBinding> = {
  DB: { kind: 'class', className: 'moodle_database' },
  PAGE: { kind: 'class', className: 'moodle_page' },
  OUTPUT: { kind: 'class', className: 'core_renderer' },
  USER: { kind: 'table', tableName: 'user' },
  COURSE: { kind: 'table', tableName: 'course' },
  SITE: { kind: 'table', tableName: 'course' },
  CFG: { kind: 'config' },
};
