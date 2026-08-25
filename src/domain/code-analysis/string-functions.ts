/** `(key, component)` 시그니처로 lang 문자열을 부르는 PHP 함수.
 *  팩트 추출·사용처 색인·완성 트리거가 모두 이 집합만 보므로 한 곳만 인식하고 다른 곳은 못 하는 비대칭이 생기지 않는다. */
export const STRING_FUNCTIONS: ReadonlySet<string> = new Set(['get_string', 'print_string']);

export function isStringFunction(name: string): boolean {
  return STRING_FUNCTIONS.has(name);
}

/** 정규식 기반 스캐너용 대안 조각 — `get_string|print_string`. */
export const STRING_FUNCTION_ALTERNATION = [...STRING_FUNCTIONS].join('|');
