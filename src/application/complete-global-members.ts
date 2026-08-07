import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { ClassMemberRepository } from '../domain/moodle-model/ports/class-member-repository';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { MOODLE_GLOBALS } from '../domain/moodle-model/globals';
import { shadowed } from './global-member-lookup';
import { GlobalMemberItem } from './dto';

/** `$DB->`·`$CFG->`·`$USER->` 같은 전역의 멤버 후보. 전역이 아닌 변수는 빈 결과이고
 *  레코드 컬럼 완성이 그쪽을 담당한다. */
export class CompleteGlobalMembers {
  constructor(private syntax: PhpSyntax, private classes: ClassMemberRepository,
              private configs: ConfigKeyRepository, private tables: TableRepository) {}

  run(text: string, varName: string, atIndex: number): GlobalMemberItem[] {
    const binding = MOODLE_GLOBALS[varName];
    if (!binding) return [];
    if (binding.kind === 'class') {
      return this.classes.membersOf(binding.className).map(m => ({
        name: m.name, detail: m.kind === 'method' ? m.signature : '', doc: m.doc, kind: m.kind,
      }));
    }
    if (binding.kind === 'config') {
      return this.configs.keys().map(k => ({ name: k.name, detail: '', doc: k.doc, kind: 'property' as const }));
    }
    if (shadowed(this.syntax.facts(text), varName, atIndex, binding)) return [];
    const table = this.tables.getTable(binding.tableName);
    return table ? table.fields.map(f => ({ name: f.name, detail: f.type, doc: f.comment, kind: 'field' as const })) : [];
  }
}
