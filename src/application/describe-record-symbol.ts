import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RecordTypeInference } from '../domain/code-analysis/record-type-inference';
import { HoverResult } from './dto';

export class DescribeRecordSymbol {
  constructor(private syntax: PhpSyntax, private tables: TableRepository, private inference: RecordTypeInference) {}
  run(text: string, atIndex: number): HoverResult | null {
    const facts = this.syntax.facts(text);
    const pa = facts.propertyAccesses.find(p => p.propIndex <= atIndex && atIndex <= p.propIndex + p.property.length);
    if (!pa) return null;
    const exists = (t: string) => this.tables.getTable(t) !== undefined;
    const binding = this.inference.infer(facts, pa.varName, pa.index, pa.scope, exists);
    if (!binding) return null;
    const field = this.tables.getTable(binding.tableName)?.findField(pa.property);
    if (!field) return null;
    const parts = [`**${binding.tableName}.${field.name}**  \`${field.type}\``];
    if (field.comment) parts.push(field.comment);
    return { markdown: parts.join('\n\n') };
  }
}
