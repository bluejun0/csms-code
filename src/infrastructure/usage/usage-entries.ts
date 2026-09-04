import { StringId } from './string-pool';

// 문자열 자리가 전부 StringId다 — 풀을 지나지 않은 값은 여기에 담길 수 없다.
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
