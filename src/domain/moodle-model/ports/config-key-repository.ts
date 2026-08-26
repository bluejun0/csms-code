import { SourceLocation } from '../../shared/value-objects';

/** `$CFG->` 완성용 납작한 이름 — config-dist.php와 설정 선언에서 모은다. */
export interface ConfigKey {
  name: string;
  doc: string;
  location: SourceLocation;
}

/** settings.php의 `admin_setting_*` 선언 하나. plugin은 저장 키 그대로(슬래시 없는 선언은 core). */
export interface ConfigDeclaration {
  plugin: string;
  key: string;
  settingClass: string;
  location: SourceLocation;
}

export interface ConfigKeyRepository {
  keys(): ConfigKey[];
  find(name: string): ConfigKey | undefined;
  declaration(plugin: string, key: string): ConfigDeclaration | undefined;
  declarationsIn(file: string): ConfigDeclaration[];
  keysOfPlugin(plugin: string): ConfigDeclaration[];
}
