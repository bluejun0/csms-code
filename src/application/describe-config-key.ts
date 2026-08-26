import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { configPlugin } from '../domain/moodle-model/services/config-plugin';
import { HoverResult } from './dto';
import { findConfigCallAt } from './config-call-lookup';

/** 설정 키 hover — plugin/key, 설정 클래스, 선언 위치(표시용 경로는 호출자가 정한다). */
export class DescribeConfigKey {
  constructor(private syntax: PhpSyntax, private configs: ConfigKeyRepository,
              private displayPath: (uri: string) => string) {}
  run(text: string, atIndex: number): HoverResult | null {
    const c = findConfigCallAt(this.syntax.facts(text), atIndex);
    if (!c) return null;
    const plugin = configPlugin(c.plugin);
    const d = this.configs.declaration(plugin, c.key);
    if (!d) return null;
    const where = `${this.displayPath(d.location.uri)}:${d.location.line + 1}`;
    return {
      markdown: [`**${plugin} / ${c.key}**`, d.settingClass, where].join('\n\n'),
      target: { kind: 'config', component: plugin, key: c.key },
    };
  }
}
