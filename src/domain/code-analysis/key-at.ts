/** 커서가 항목의 key 리터럴 내용 범위 안(양 끝 포함)에 있는 첫 항목.
 *  PHP·JS·mustache 문자열 호출이 모두 이 한 규칙으로 판정되어야 표면마다 경계가 갈리지 않는다. */
export function itemWithKeyAt<T extends { key: string; keyIndex: number }>(items: readonly T[], atIndex: number): T | undefined {
  return items.find(c => c.keyIndex <= atIndex && atIndex <= c.keyIndex + c.key.length);
}
