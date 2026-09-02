import { TableRepository } from '../domain/moodle-model/ports/table-repository';

/** 테이블 하나를 가리키는 좌표 — 컬럼은 대상이 아니다(테이블 이름만). */
export interface TableTarget { name: string; }

/** install.xml의 `<TABLE>` 선언 줄에서 대상을 확정한다. FIELD 줄이나 다른 줄은 null. */
export class LocateTableTarget {
  constructor(private tables: TableRepository) {}
  installXml(file: string, line: number): TableTarget | null {
    const t = this.tables.tablesIn(file).find(x => x.location.line === line);
    return t ? { name: t.name } : null;
  }
}
