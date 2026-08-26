import { configPlugin } from '../domain/moodle-model/services/config-plugin';

// get_config('plugin', '<커서> — 키 리터럴을 입력하는 중. set_config는 키가 먼저 와서 플러그인을 아직 모른다.
const KEY_PREFIX_RE = /\bget_config\(\s*['"](\w*)['"]\s*,\s*['"]\w*$/;

/** 커서가 get_config의 키 리터럴을 입력 중이면 그 플러그인(core 별칭은 접음), 아니면 null */
export function configKeyCompletionPlugin(before: string): string | null {
  const m = before.match(KEY_PREFIX_RE);
  return m ? configPlugin(m[1]) : null;
}
