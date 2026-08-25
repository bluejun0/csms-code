/** lang 파일의 한 줄에서 커서가 $string['key']의 key 내용 위에 있으면 그 키를 반환.
 *  키는 홑따옴표·겹따옴표 모두 — 파서(lang-file-parser)가 읽는 키를 여기서 못 읽으면 F12는 되는데 Shift+F12만 안 되는 비대칭이 생긴다. */
export function langKeyAt(lineText: string, character: number): string | null {
  const m = lineText.match(/\$string\[\s*(?:'([^']+)'|"([^"]+)")\s*\]/);
  if (!m || m.index === undefined) return null;
  const key = m[1] ?? m[2];
  const keyStart = m.index + m[0].search(/['"]/) + 1;
  return character >= keyStart && character <= keyStart + key.length ? key : null;
}
