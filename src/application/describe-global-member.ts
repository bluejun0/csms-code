import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { ClassMemberRepository } from '../domain/moodle-model/ports/class-member-repository';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { globalMemberAt } from './global-member-lookup';
import { HoverResult } from './dto';

export class DescribeGlobalMember {
  constructor(private syntax: PhpSyntax, private classes: ClassMemberRepository,
              private configs: ConfigKeyRepository, private tables: TableRepository) {}

  /** 커서가 전역 멤버를 짚고 있는지 — 팩트만 보므로 색인 없이 답한다.
   *  프로바이더가 이걸 먼저 물어 무관한 위치에서 지연 빌드를 깨우지 않게 한다. */
  targets(text: string, atIndex: number): boolean {
    return globalMemberAt(this.syntax.facts(text), atIndex) !== null;
  }

  run(text: string, atIndex: number): HoverResult | null {
    const hit = globalMemberAt(this.syntax.facts(text), atIndex);
    if (!hit) return null;
    if (hit.binding.kind === 'class') {
      const m = this.classes.membersOf(hit.binding.className).find(x => x.name === hit.member);
      if (!m) return null;
      const head = m.kind === 'method'
        ? `**${hit.binding.className}::${m.name}**\`${m.signature}\``
        : `**${hit.binding.className}::$${m.name}**`;
      return { markdown: m.doc ? `${head}\n\n${m.doc}` : head };
    }
    if (hit.binding.kind === 'config') {
      const k = this.configs.find(hit.member);
      if (!k) return null;
      return { markdown: k.doc ? `**$CFG->${k.name}**\n\n${k.doc}` : `**$CFG->${k.name}**` };
    }
    const field = this.tables.getTable(hit.binding.tableName)?.findField(hit.member);
    if (!field) return null;
    const head = `**${hit.binding.tableName}.${field.name}**  \`${field.type}\``;
    return { markdown: field.comment ? `${head}\n\n${field.comment}` : head };
  }
}
