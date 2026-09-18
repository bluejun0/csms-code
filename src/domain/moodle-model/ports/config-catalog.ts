import { ConfigDeclaration } from './config-key-repository';

/** 플러그인 탐색기용 열거. 이 색인은 지연 생성이라 준비 전에는 빈 결과를 준다. */
export interface ConfigCatalog {
  components(): string[];
  keysOfPlugin(plugin: string): ConfigDeclaration[];
}
