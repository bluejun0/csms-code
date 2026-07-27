export interface SourceLocation { uri: string; line: number; column: number; }

export function parseFrankenstyle(raw: string): { type: string; name: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const i = s.indexOf('_');
  if (i < 0) return { type: 'core', name: s };
  return { type: s.slice(0, i), name: s.slice(i + 1) };
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
