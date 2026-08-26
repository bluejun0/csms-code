import {
  STRING_FUNCTION_ALTERNATION, STRING_CLASS_ALTERNATION,
  stringFunctionForm, stringClassForm, effectiveComponent,
} from '../domain/code-analysis/string-functions';

// 첫 인자(키 리터럴)를 입력하는 중 — 컴포넌트 인자 위치나 다른 함수는 비매칭
const KEY_PREFIX_RE = new RegExp(`(?:\\b(${STRING_FUNCTION_ALTERNATION})|new\\s+\\\\?(${STRING_CLASS_ALTERNATION}))\\(\\s*['"][\\w:./-]*$`);

/** 커서 앞 텍스트가 문자열 호출의 키 리터럴을 입력 중인 문맥인지 */
export function isStringKeyPrefix(before: string): boolean {
  return KEY_PREFIX_RE.test(before);
}

/** 완성할 키의 컴포넌트. 커서 뒤에 컴포넌트 리터럴이 오면 그것, 바로 닫히는 한 인자 꼴이면 그 형태의 기본,
 *  아직 어느 쪽도 아니면 null — 컴포넌트를 모르는 채 core 전체를 제안하면 틀린 목록이 된다. */
export function stringKeyCompletionComponent(before: string, after: string): string | null {
  const m = before.match(KEY_PREFIX_RE);
  if (!m) return null;
  const form = m[1] ? stringFunctionForm(m[1]) : stringClassForm(m[2]);
  if (!form) return null;
  const cm = after.match(/^[\w:./-]*['"]\s*,\s*['"](\w*)['"]/);
  if (cm) return effectiveComponent(form, cm[1]);
  return /^[\w:./-]*['"]\s*\)/.test(after) ? effectiveComponent(form, '') : null;
}
