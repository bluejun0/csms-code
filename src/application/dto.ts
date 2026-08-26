import { SourceLocation } from '../domain/shared/value-objects';
export interface ColumnItem { name: string; type: string; comment: string; }
export interface StringItem { key: string; ko?: string; en?: string; }
export interface DefinitionResult { location: SourceLocation; }
/** 문자열 하나를 가리키는 canonical 좌표 — 사용처 색인과 lang 색인이 모두 이 이름으로 키를 잡는다. */
export interface StringTarget { component: string; key: string; }
/** hover가 가리키는 참조 대상 — 프레젠테이션이 종류에 맞는 사용처 명령·개수로 링크를 붙인다. 설정은 component 자리에 plugin. */
export interface ReferenceTarget extends StringTarget { kind: 'string' | 'config'; }
/** `target`은 문자열·설정 hover에만 실린다. */
export interface HoverResult { markdown: string; target?: ReferenceTarget; }
export interface ConfigKeyItem { key: string; settingClass: string; }
export type DiagnosticKind = 'column' | 'string';
export interface DiagnosticItem { kind: DiagnosticKind; line: number; column0: number; length: number; message: string; suggestion?: string; }
export interface GlobalMemberItem { name: string; detail: string; doc: string; kind: 'method' | 'property' | 'field'; }
export interface RangeItem { line: number; column0: number; length: number; }
