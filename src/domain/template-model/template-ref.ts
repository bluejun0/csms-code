export interface TemplateRef { component: string; name: string; }

/** `component/name` 통짜 문자열 분해 — `/`가 없으면 템플릿 참조가 아니다(침묵). name은 하위 경로 포함 가능. */
export function parseTemplateRef(raw: string): TemplateRef | null {
  const i = raw.indexOf('/');
  if (i <= 0 || i === raw.length - 1) return null;
  return { component: raw.slice(0, i), name: raw.slice(i + 1) };
}
