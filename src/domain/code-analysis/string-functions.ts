/** `(key, component)`로 lang 문자열을 가리키는 PHP 호출 형태 — 함수 호출(`name(...)`)과 생성(`new name(...)`).
 *  팩트 추출·사용처 색인·완성 트리거가 모두 이 표만 보므로 한 곳만 인식하고 다른 곳은 못 하는 비대칭이 생기지 않는다. */
export interface StringCallForm {
  kind: 'function' | 'class';
  name: string;
  /** 컴포넌트를 생략했을 때 찾는 곳. error 계열은 `moodle`·`core`를 적어도 error로 간다(moodle_exception의 규칙). */
  defaultComponent: 'core' | 'error';
}

export const STRING_CALL_FORMS: readonly StringCallForm[] = [
  { kind: 'function', name: 'get_string', defaultComponent: 'core' },
  { kind: 'function', name: 'print_string', defaultComponent: 'core' },
  { kind: 'function', name: 'print_error', defaultComponent: 'error' },
  { kind: 'class', name: 'moodle_exception', defaultComponent: 'error' },
  { kind: 'class', name: 'lang_string', defaultComponent: 'core' },
  { kind: 'class', name: 'help_icon', defaultComponent: 'core' },
];

const functions = new Map(STRING_CALL_FORMS.filter(f => f.kind === 'function').map(f => [f.name, f] as const));
const classes = new Map(STRING_CALL_FORMS.filter(f => f.kind === 'class').map(f => [f.name, f] as const));

export function stringFunctionForm(name: string): StringCallForm | undefined { return functions.get(name); }
export function stringClassForm(name: string): StringCallForm | undefined { return classes.get(name); }

/** 호출에 적힌 컴포넌트(생략은 '')를 그 형태의 규칙으로 — 생략·`moodle`·`core`는 기본 컴포넌트,
 *  나머지는 그대로 둔다(canonical 정규화는 색인이 한다). */
export function effectiveComponent(form: StringCallForm, rawComponent: string): string {
  return rawComponent === '' || rawComponent === 'moodle' || rawComponent === 'core' ? form.defaultComponent : rawComponent;
}

/** 정규식 기반 스캐너용 대안 조각 — `get_string|print_string|print_error`, `moodle_exception|lang_string|help_icon`. */
export const STRING_FUNCTION_ALTERNATION = [...functions.keys()].join('|');
export const STRING_CLASS_ALTERNATION = [...classes.keys()].join('|');
