import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { DefinitionResult } from './dto';

/** SQL 문자열의 `{table}` 참조 → install.xml의 TABLE 선언 위치.
 *  색인에 없는 이름은 빈 결과 — 문자열 안의 `{4}`·`{Bucket}` 같은 비테이블 중괄호가 훨씬 많다. */
export class ResolveTableDefinition {
  constructor(private syntax: PhpSyntax, private tables: TableRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const ref = this.syntax.facts(text).tableRefs
      .find(r => r.nameIndex <= atIndex && atIndex <= r.nameIndex + r.name.length);
    if (!ref) return [];
    const table = this.tables.getTable(ref.name);
    return table ? [{ location: table.location }] : [];
  }
}
