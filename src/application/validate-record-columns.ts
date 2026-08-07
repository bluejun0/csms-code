import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RecordTypeInference } from '../domain/code-analysis/record-type-inference';
import { closestColumn } from '../domain/moodle-model/services/column-validator';
import { DiagnosticItem } from './dto';

export class ValidateRecordColumns {
  constructor(private syntax: PhpSyntax, private tables: TableRepository, private inference: RecordTypeInference) {}
  run(text: string): DiagnosticItem[] {
    const facts = this.syntax.facts(text);
    const exists = (t: string) => this.tables.getTable(t) !== undefined;
    const out: DiagnosticItem[] = [];
    for (const pa of facts.propertyAccesses) {
      const binding = this.inference.infer(facts, pa.varName, pa.index, pa.scope, exists);
      if (!binding) continue;                 // 확신 없으면 스킵(오탐 방지)
      const table = this.tables.getTable(binding.tableName);
      if (!table || table.hasField(pa.property)) continue;
      out.push({
        kind: 'column',
        line: pa.propLine, column0: pa.propColumn, length: pa.property.length,
        message: `'${binding.tableName}' 테이블에 '${pa.property}' 컬럼이 없습니다.`,
        suggestion: closestColumn(table, pa.property),
      });
    }
    return out;
  }
}
