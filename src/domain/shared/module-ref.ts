export interface ModuleRef { component: string; name: string; }

/** `component/name` 분해 — 템플릿 참조와 AMD 모듈 참조가 같은 규칙을 쓴다.
 *  `/`가 없거나 양 끝에 있으면 참조가 아니다(침묵). name은 하위 경로를 포함할 수 있다. */
export function parseModuleRef(raw: string): ModuleRef | null {
  const i = raw.indexOf('/');
  if (i <= 0 || i === raw.length - 1) return null;
  return { component: raw.slice(0, i), name: raw.slice(i + 1) };
}
