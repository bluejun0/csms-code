import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { configPlugin } from '../domain/moodle-model/services/config-plugin';
import { findConfigCallAt } from './config-call-lookup';

/** 설정 하나를 가리키는 좌표 — plugin은 저장 키 그대로(core 별칭만 접음). */
export interface ConfigTarget { plugin: string; key: string; }

/** 커서 위치의 설정 호출(코드) 또는 선언 줄(settings.php)을 (plugin, key)로 확정한다. */
export class LocateConfigTarget {
  constructor(private syntax: PhpSyntax, private configs: ConfigKeyRepository) {}

  php(text: string, atIndex: number): ConfigTarget | null {
    const c = findConfigCallAt(this.syntax.facts(text), atIndex);
    return c ? { plugin: configPlugin(c.plugin), key: c.key } : null;
  }

  /** settings.php의 선언 줄(`new admin_setting_*` 줄)에서 */
  settings(file: string, line: number): ConfigTarget | null {
    const d = this.configs.declarationsIn(file).find(x => x.location.line === line);
    return d ? { plugin: d.plugin, key: d.key } : null;
  }
}
