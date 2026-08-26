/** 플러그인 설정을 읽고 쓰는 함수. get_config(plugin, key) / set_config(key, value, plugin) — 인자 자리가 다르다. */
const KINDS: ReadonlyMap<string, 'get' | 'set'> = new Map([['get_config', 'get'], ['set_config', 'set']]);

export function configFunctionKind(name: string): 'get' | 'set' | undefined {
  return KINDS.get(name);
}
