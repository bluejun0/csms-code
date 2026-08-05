/** lang 파일의 한 줄에서 커서가 $string['key']의 key 내용 위에 있으면 그 키를 반환 */
export function langKeyAt(lineText: string, character: number): string | null {
  const m = lineText.match(/\$string\[\s*'([^']+)'\s*\]/);
  if (!m || m.index === undefined) return null;
  const keyStart = m.index + m[0].indexOf("'") + 1;
  return character >= keyStart && character <= keyStart + m[1].length ? m[1] : null;
}
