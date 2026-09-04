import { StringId } from './string-pool';

// 문자열 자리가 전부 StringId(= number)다. 다른 number를 잘못 넣는 실수까지 막지는 못하지만,
// 문자열 값 자체는 타입 오류 없이는 여기 담길 수 없다.
export interface StringUsage { component: StringId; key: StringId; file: StringId; line: number; column: number }
export interface RefUsage { ref: StringId; file: StringId; line: number; column: number }
export interface ConfigUsage { id: StringId; file: StringId; line: number; column: number }
export interface TableUsage { name: StringId; file: StringId; line: number; column: number }

export interface UsageExtract {
  strings: StringUsage[];
  templates: RefUsage[];
  amd: RefUsage[];
  config: ConfigUsage[];
  tables: TableUsage[];
}

export function emptyExtract(): UsageExtract {
  return { strings: [], templates: [], amd: [], config: [], tables: [] };
}
