import { Table } from '../table';
import { levenshtein } from '../../shared/value-objects';

export function closestColumn(table: Table, column: string, maxDistance = 3): string | undefined {
  let best: string | undefined; let bestD = maxDistance + 1;
  for (const name of table.fieldNames()) {
    const d = levenshtein(column, name);
    if (d < bestD) { bestD = d; best = name; }
  }
  return bestD <= maxDistance ? best : undefined;
}
