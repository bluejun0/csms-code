import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { ClassMemberRepository } from '../domain/moodle-model/ports/class-member-repository';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { globalMemberAt } from './global-member-lookup';
import { DefinitionResult } from './dto';

export class ResolveGlobalMemberDefinition {
  constructor(private syntax: PhpSyntax, private classes: ClassMemberRepository,
              private configs: ConfigKeyRepository, private tables: TableRepository) {}

  run(text: string, atIndex: number): DefinitionResult[] {
    const hit = globalMemberAt(this.syntax.facts(text), atIndex);
    if (!hit) return [];
    if (hit.binding.kind === 'class') {
      const m = this.classes.membersOf(hit.binding.className).find(x => x.name === hit.member);
      return m ? [{ location: m.location }] : [];
    }
    if (hit.binding.kind === 'config') {
      const k = this.configs.find(hit.member);
      return k ? [{ location: k.location }] : [];
    }
    const field = this.tables.getTable(hit.binding.tableName)?.findField(hit.member);
    return field ? [{ location: field.location }] : [];
  }
}
