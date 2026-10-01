import {
  STRING_FUNCTION_ALTERNATION, STRING_CLASS_ALTERNATION, STRING_METHOD_ALTERNATION, STRING_KEY_LIST_METHOD_ALTERNATION,
  StringCallForm, stringFunctionForm, stringClassForm, stringMethodForm, stringKeyListMethodForm, effectiveComponent,
} from '../domain/code-analysis/string-functions';

// 첫 인자(키 리터럴)를 입력하는 중 — 컴포넌트 인자 위치나 다른 함수는 비매칭
const KEY_PREFIX_RE = new RegExp(`(?:\\b(${STRING_FUNCTION_ALTERNATION})|new\\s+\\\\?(${STRING_CLASS_ALTERNATION})|->(${STRING_METHOD_ALTERNATION}))\\(\\s*['"][\\w:./-]*$`);
// 키 배열의 원소를 입력하는 중 — 앞선 원소가 있어도 된다
const KEY_LIST_PREFIX_RE = new RegExp(`->(${STRING_KEY_LIST_METHOD_ALTERNATION})\\(\\s*(?:\\[|array\\()(?:\\s*['"][\\w:./-]*['"]\\s*,)*\\s*['"][\\w:./-]*$`);
// 키 배열에서 커서 뒤 — 남은 원소와 배열 닫힘을 지나 컴포넌트 리터럴
const KEY_LIST_COMPONENT_RE = /^[\w:./-]*['"](?:\s*,\s*['"][\w:./-]*['"])*\s*,?\s*[\])]\s*,\s*['"](\w*)['"]/;

/** 커서 앞 텍스트가 문자열 호출의 키 리터럴을 입력 중인 문맥인지 */
export function isStringKeyPrefix(before: string): boolean {
  return KEY_PREFIX_RE.test(before) || KEY_LIST_PREFIX_RE.test(before);
}

/** 완성할 키의 컴포넌트. 커서 뒤에 컴포넌트 리터럴이 오면 그것, 바로 닫히는 한 인자 꼴이면 그 형태의 기본,
 *  아직 어느 쪽도 아니면 null — 컴포넌트를 모르는 채 core 전체를 제안하면 틀린 목록이 된다.
 *  before·after는 여러 줄이어도 된다 — 키 배열은 보통 원소마다 줄을 바꾼다. */
export function stringKeyCompletionComponent(before: string, after: string): string | null {
  const list = before.match(KEY_LIST_PREFIX_RE);
  if (list) {
    const form = stringKeyListMethodForm(list[1]);
    const cm = after.match(KEY_LIST_COMPONENT_RE);
    return form && cm ? effectiveComponent(form, cm[1]) : null;
  }
  const m = before.match(KEY_PREFIX_RE);
  if (!m) return null;
  const form = callForm(m);
  if (!form) return null;
  const cm = after.match(/^[\w:./-]*['"]\s*,\s*['"](\w*)['"]/);
  if (cm) return effectiveComponent(form, cm[1]);
  if (form.kind === 'method') return null; // 컴포넌트가 필수인 꼴
  return /^[\w:./-]*['"]\s*\)/.test(after) ? effectiveComponent(form, '') : null;
}

function callForm(m: RegExpMatchArray): StringCallForm | undefined {
  if (m[1]) return stringFunctionForm(m[1]);
  if (m[2]) return stringClassForm(m[2]);
  return stringMethodForm(m[3]);
}
