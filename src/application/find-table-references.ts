import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { TableUsageRepository } from '../domain/moodle-model/ports/table-usage-repository';
import { SourceLocation } from '../domain/shared/value-objects';

/** 테이블 이름의 사용처 — SQL의 `{table}`과 `$DB` 메서드의 테이블 인자.
 *  `includeDeclaration`이면 install.xml의 선언 위치도 함께 넣는다. 색인에 없는 이름은 빈 목록(침묵). */
export class FindTableReferences {
  constructor(private usages: TableUsageRepository, private tables: TableRepository) {}
  run(name: string, includeDeclaration = false): SourceLocation[] {
    const table = this.tables.getTable(name);
    if (!table) return [];
    const out: SourceLocation[] = [];
    if (includeDeclaration) out.push(table.location);
    out.push(...this.usages.tableRefsOf(name));
    return out;
  }
}
