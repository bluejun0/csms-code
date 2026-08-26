import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { configPlugin } from '../domain/moodle-model/services/config-plugin';
import { DefinitionResult } from './dto';
import { findConfigCallAt } from './config-call-lookup';

/** 설정 호출의 키에서 F12 → settings.php의 선언 위치 */
export class ResolveConfigDefinition {
  constructor(private syntax: PhpSyntax, private configs: ConfigKeyRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const c = findConfigCallAt(this.syntax.facts(text), atIndex);
    if (!c) return [];
    const d = this.configs.declaration(configPlugin(c.plugin), c.key);
    return d ? [{ location: d.location }] : [];
  }
}
