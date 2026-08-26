import { ConfigUsageRepository } from '../domain/moodle-model/ports/config-usage-repository';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { configPlugin } from '../domain/moodle-model/services/config-plugin';
import { SourceLocation } from '../domain/shared/value-objects';

/** (plugin, key)의 사용처 — get_config·set_config 호출. `includeDeclaration`이면 settings.php 선언도 함께 넣는다. */
export class FindConfigReferences {
  constructor(private usages: ConfigUsageRepository, private configs: ConfigKeyRepository) {}
  run(plugin: string, key: string, includeDeclaration = false): SourceLocation[] {
    const p = configPlugin(plugin);
    const out: SourceLocation[] = [];
    if (includeDeclaration) {
      const d = this.configs.declaration(p, key);
      if (d) out.push(d.location);
    }
    out.push(...this.usages.configRefsOf(p, key));
    return out;
  }
}
