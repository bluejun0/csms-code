import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { ClassMemberRepository } from '../domain/moodle-model/ports/class-member-repository';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { globalMemberAt } from './global-member-lookup';
import { DefinitionResult } from './dto';

export class ResolveGlobalMemberDefinition {
  constructor(private syntax: PhpSyntax, private classes: ClassMemberRepository,
              private configs: ConfigKeyRepository, private tables: TableRepository) {}

  /** 커서가 전역 멤버를 짚고 있는지 — 팩트만 보므로 색인 없이 답한다.
   *  프로바이더가 이걸 먼저 물어 무관한 위치에서 지연 빌드를 깨우지 않게 한다. */
  targets(text: string, atIndex: number): boolean {
    return globalMemberAt(this.syntax.facts(text), atIndex) !== null;
  }

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
