import { STRING_FUNCTION_ALTERNATION } from '../domain/code-analysis/string-functions';

// 첫 인자(키 리터럴)를 입력하는 중 — 컴포넌트 인자 위치나 다른 함수는 비매칭
const KEY_PREFIX_RE = new RegExp(`(?:${STRING_FUNCTION_ALTERNATION})\\(\\s*['"][\\w:./-]*$`);

/** 커서 앞 텍스트가 문자열 함수의 키 리터럴을 입력 중인 문맥인지 */
export function isStringKeyPrefix(before: string): boolean {
  return KEY_PREFIX_RE.test(before);
}
