import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { ConfigKeyItem } from './dto';

/** get_config('plugin', '|')의 키 완성 — 그 플러그인의 선언된 키 */
export class CompleteConfigKeys {
  constructor(private configs: ConfigKeyRepository) {}
  run(plugin: string): ConfigKeyItem[] {
    return this.configs.keysOfPlugin(plugin).map(d => ({ key: d.key, settingClass: d.settingClass }));
  }
}
