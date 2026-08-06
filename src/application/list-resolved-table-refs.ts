import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RangeItem } from './dto';

/** 색인에 존재하는 테이블 참조의 범위 — 하이라이트용 */
export class ListResolvedTableRefs {
  constructor(private syntax: PhpSyntax, private tables: TableRepository) {}
  run(text: string): RangeItem[] {
    return this.syntax.facts(text).tableRefs
      .filter(r => this.tables.getTable(r.name) !== undefined)
      .map(r => ({ line: r.nameLine, column0: r.nameColumn, length: r.name.length }));
  }
}
