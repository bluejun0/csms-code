export interface Scope { start: number; end: number; }
export interface RecordAssignment { varName: string; receiver: string; method: string; tableArg: string | null; index: number; scope: Scope; }
export interface ForeachBinding { collectionVar: string; itemVar: string; index: number; scope: Scope; }
export interface DataArgBinding { method: string; tableArg: string; dataVar: string; index: number; scope: Scope; }
export interface PhpdocVar { varName: string; typeText: string; index: number; scope: Scope; }
export interface PropertyAccess { varName: string; property: string; propLine: number; propColumn: number; propIndex: number; index: number; scope: Scope; }
export interface PlainAssignment { varName: string; index: number; scope: Scope; }
export interface StringCall {
  key: string; component: string;
  keyLine: number; keyColumn: number; keyIndex: number;
  index: number;
}
export interface TemplateCall {
  ref: string;
  refLine: number; refColumn: number; refIndex: number;
  index: number;
}
/** `get_string('key', <표현식>)`의 컴포넌트 인자 형태. 리터럴이 아니면 이 참조로 담고
 *  같은 파일의 리터럴 정의로 한 단계 거슬러 올라가 해석한다. */
export type ComponentRef =
  | { kind: 'var'; name: string }
  | { kind: 'prop'; name: string }
  | { kind: 'const'; name: string };

export interface DynamicStringCall {
  key: string; comp: ComponentRef;
  keyLine: number; keyColumn: number; keyIndex: number;
  index: number; scope: Scope;
}
/** `$x = 'literal'` — RHS 리터럴이 필요해 plainAssignments로는 안 된다. */
export interface LiteralAssignment { varName: string; value: string; index: number; scope: Scope; }
/** 프로퍼티 선언 기본값 `public $p = 'literal';` — 생성자 대입은 담지 않는다. */
export interface PropertyLiteral { property: string; value: string; index: number; }
/** `const NAME = 'literal';` */
export interface ConstLiteral { name: string; value: string; index: number; }

/** `$var->method(…)` 호출 — 프로퍼티 접근(member_access_expression)과는 다른 노드다. */
export interface MethodCall {
  varName: string; method: string;
  nameLine: number; nameColumn: number; nameIndex: number;
  index: number; scope: Scope;
}
/** `js_call_amd('component/name', …)`의 모듈 참조. */
export interface AmdCall {
  ref: string;
  refLine: number; refColumn: number; refIndex: number;
  index: number;
}
/** Moodle SQL의 테이블 참조 `{name}` — 문자열 리터럴 안에 있고 스코프와 무관하다. */
export interface TableRef {
  name: string;
  nameLine: number; nameColumn: number; nameIndex: number;
}
/** `get_config('plugin', 'key')`·`set_config('key', v, 'plugin')` — 플러그인이 리터럴. plugin은 저장 키 그대로(정규화 없음). */
export interface ConfigCall {
  plugin: string; key: string; kind: 'get' | 'set';
  keyLine: number; keyColumn: number; keyIndex: number;
  index: number;
}
/** 플러그인 인자가 리터럴이 아닌 설정 호출 — DynamicStringCall과 같은 세 형태, 같은 전파로 해석한다. */
export interface DynamicConfigCall {
  key: string; comp: ComponentRef; kind: 'get' | 'set';
  keyLine: number; keyColumn: number; keyIndex: number;
  index: number; scope: Scope;
}
/** 컴포넌트 참조가 놓인 자리 — 전파는 참조 형태·위치·스코프만 본다. */
export interface ComponentRefSite { comp: ComponentRef; index: number; scope: Scope; }

export interface DocumentFacts {
  assignments: RecordAssignment[];
  foreachBindings: ForeachBinding[];
  dataArgBindings: DataArgBinding[];
  phpdocVars: PhpdocVar[];
  propertyAccesses: PropertyAccess[];
  plainAssignments: PlainAssignment[];
  stringCalls: StringCall[];
  templateCalls: TemplateCall[];
  amdCalls: AmdCall[];
  methodCalls: MethodCall[];
  dynamicStringCalls: DynamicStringCall[];
  literalAssignments: LiteralAssignment[];
  propertyLiterals: PropertyLiteral[];
  constLiterals: ConstLiteral[];
  tableRefs: TableRef[];
  configCalls: ConfigCall[];
  dynamicConfigCalls: DynamicConfigCall[];
}

/** 팩트 없음 — 파싱이 불가능한 문서를 침묵으로 처리할 때 쓴다. 새 팩트 종류가 늘어도 여기만 고치면 된다. */
export function emptyFacts(): DocumentFacts {
  return {
    assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [],
    propertyAccesses: [], plainAssignments: [], stringCalls: [], templateCalls: [], amdCalls: [], methodCalls: [], tableRefs: [],
    dynamicStringCalls: [], literalAssignments: [], propertyLiterals: [], constLiterals: [],
    configCalls: [], dynamicConfigCalls: [],
  };
}

export type FactKind = keyof DocumentFacts;
