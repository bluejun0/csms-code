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
  tableRefs: TableRef[];
}

/** 팩트 없음 — 파싱이 불가능한 문서를 침묵으로 처리할 때 쓴다. 새 팩트 종류가 늘어도 여기만 고치면 된다. */
export function emptyFacts(): DocumentFacts {
  return {
    assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [],
    propertyAccesses: [], plainAssignments: [], stringCalls: [], templateCalls: [], amdCalls: [], methodCalls: [], tableRefs: [],
  };
}
