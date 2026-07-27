import { Table, Field } from '../../domain/moodle-model/table';
import { TableRepository } from '../../domain/moodle-model/ports/table-repository';

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

/** install.xml → Table[] (FIELD line 0-based). 한 줄 다중 FIELD도 첫 위치로 근사. */
export function parseInstallXml(xmlText: string, uri: string, component: string): Table[] {
  const lines = xmlText.split(/\r?\n/);
  const tables: Table[] = [];
  let cur: { name: string; comment: string; line: number; fields: Field[] } | null = null;

  lines.forEach((line, idx) => {
    const tableOpen = line.match(/<TABLE\b[^>]*>/i);
    if (tableOpen) {
      const tag = tableOpen[0];
      const name = attr(tag, 'NAME');
      if (name) cur = { name, comment: attr(tag, 'COMMENT') ?? '', line: idx, fields: [] };
      return;
    }
    if (/<\/TABLE>/i.test(line) && cur) {
      tables.push(new Table(cur.name, component, cur.fields, { uri, line: cur.line, column: 0 }));
      cur = null;
      return;
    }
    const fieldTag = line.match(/<FIELD\b[^>]*\/?>/i);
    if (fieldTag && cur) {
      const tag = fieldTag[0];
      const name = attr(tag, 'NAME');
      if (!name) return;
      const col = Math.max(0, line.indexOf('<FIELD'));
      cur.fields.push({
        name,
        type: (attr(tag, 'TYPE') ?? '').toLowerCase(),
        comment: attr(tag, 'COMMENT') ?? '',
        notnull: (attr(tag, 'NOTNULL') ?? 'false').toLowerCase() === 'true',
        default: attr(tag, 'DEFAULT'),
        location: { uri, line: idx, column: col },
      });
    }
  });
  return tables;
}

/** 색인된 Table[]을 담는 단순 리포지토리 */
export class InMemoryTableRepository implements TableRepository {
  private byName = new Map<string, Table>();
  constructor(tables: Table[] = []) { this.replaceAll(tables); }
  replaceAll(tables: Table[]) { this.byName.clear(); for (const t of tables) this.byName.set(t.name, t); }
  upsert(tables: Table[]) { for (const t of tables) this.byName.set(t.name, t); }
  removeByUri(uri: string) { for (const [n, t] of this.byName) if (t.location.uri === uri) this.byName.delete(n); }
  getTable(name: string): Table | undefined { return this.byName.get(name); }
  allTableNames(): string[] { return [...this.byName.keys()]; }
}
