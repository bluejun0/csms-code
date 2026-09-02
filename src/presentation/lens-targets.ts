import { ReferenceCounter, SHOW_AMD_REFERENCES_COMMAND, SHOW_CONFIG_REFERENCES_COMMAND, SHOW_STRING_REFERENCES_COMMAND, SHOW_TABLE_REFERENCES_COMMAND, SHOW_TEMPLATE_REFERENCES_COMMAND, UsageLensTarget } from './references-link';

const countOf = (counter: ReferenceCounter, component: string, key: string) =>
  () => counter.built() ? counter.count(component, key) : null;

/** lang 파일: `$string['key']` 줄마다 문자열 사용처 버튼 */
export function langLensTargets(uri: string, entries: { key: string; line: number }[], component: string,
                                counter: ReferenceCounter): UsageLensTarget[] {
  return entries.map(e => ({
    line: e.line, command: SHOW_STRING_REFERENCES_COMMAND,
    args: { uri, line: e.line, character: 0, component, key: e.key },
    count: countOf(counter, component, e.key),
  }));
}

/** 파일 전체가 하나의 대상(템플릿·AMD 모듈)인 파일 — 맨 위에 사용처 버튼 하나 */
function wholeFileTargets(command: string, uri: string, ref: { component: string; name: string },
                          counter: ReferenceCounter): UsageLensTarget[] {
  return [{
    line: 0, command,
    args: { uri, line: 0, character: 0, component: ref.component, key: ref.name },
    count: countOf(counter, ref.component, ref.name),
  }];
}

export function templateLensTargets(uri: string, ref: { component: string; name: string },
                                    counter: ReferenceCounter): UsageLensTarget[] {
  return wholeFileTargets(SHOW_TEMPLATE_REFERENCES_COMMAND, uri, ref, counter);
}

export function amdLensTargets(uri: string, ref: { component: string; name: string },
                               counter: ReferenceCounter): UsageLensTarget[] {
  return wholeFileTargets(SHOW_AMD_REFERENCES_COMMAND, uri, ref, counter);
}

/** install.xml: `<TABLE>` 선언 줄마다 테이블 사용처 버튼. 테이블은 이름만 대상이라 component 자리는 비운다. */
export function tableLensTargets(uri: string,
                                 tables: { name: string; location: { line: number; column: number } }[],
                                 counter: ReferenceCounter): UsageLensTarget[] {
  return tables.map(t => ({
    line: t.location.line, command: SHOW_TABLE_REFERENCES_COMMAND,
    args: { uri, line: t.location.line, character: t.location.column, component: '', key: t.name },
    count: countOf(counter, '', t.name),
  }));
}

/** settings.php: `new admin_setting_*(…)` 선언 줄마다 설정 사용처 버튼 — peek은 첫 인자 위치에 연다 */
export function settingsLensTargets(uri: string,
                                    decls: { plugin: string; key: string; location: { line: number; column: number } }[],
                                    counter: ReferenceCounter): UsageLensTarget[] {
  return decls.map(d => ({
    line: d.location.line, command: SHOW_CONFIG_REFERENCES_COMMAND,
    args: { uri, line: d.location.line, character: d.location.column, component: d.plugin, key: d.key },
    count: countOf(counter, d.plugin, d.key),
  }));
}
