import { levenshtein } from '../../shared/value-objects';

export function closestKey(keys: string[], key: string, maxDistance = 3): string | undefined {
  let best: string | undefined; let bestD = maxDistance + 1;
  for (const k of keys) {
    const d = levenshtein(key, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= maxDistance ? best : undefined;
}
