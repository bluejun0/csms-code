export interface ReleaseInfo {
  version: string;
  notes: string;
  pageUrl: string;
  assetUrl?: string;
}

const parts = (v: string): number[] =>
  v.replace(/^v/, '').split('.').map(n => Number.parseInt(n, 10) || 0);

/** 자릿수를 수치로 비교한다 — 문자열 비교로는 0.23.10이 0.23.9보다 낮게 나온다. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parts(candidate), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
