/** raw component → canonical 색인 키. bare 이름은 코어 서브시스템(core_<s> 존재) 우선, 아니면 레거시 mod 단축.
 *  존재 판정은 주입(hasCanonical) — 도메인은 색인 구현을 모른다. */
export function normalizeComponent(raw: string, hasCanonical: (c: string) => boolean): string {
  const s = raw.trim();
  if (!s || s === 'moodle' || s === 'core') return 'core';
  if (s.includes('_')) return s;
  if (hasCanonical(`core_${s}`)) return `core_${s}`;
  return `mod_${s}`;
}
