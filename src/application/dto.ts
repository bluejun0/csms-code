import { SourceLocation } from '../domain/shared/value-objects';
export interface ColumnItem { name: string; type: string; comment: string; }
export interface StringItem { key: string; ko?: string; en?: string; }
export interface DefinitionResult { location: SourceLocation; }
/** 문자열 하나를 가리키는 canonical 좌표 — 사용처 색인과 lang 색인이 모두 이 이름으로 키를 잡는다. */
export interface StringTarget { component: string; key: string; }
/** `target`은 문자열 hover에만 실린다 — 프레젠테이션이 사용처 링크를 붙일 때 이 좌표로 색인을 조회한다. */
export interface HoverResult { markdown: string; target?: StringTarget; }
export type DiagnosticKind = 'column' | 'string';
export interface DiagnosticItem { kind: DiagnosticKind; line: number; column0: number; length: number; message: string; suggestion?: string; }
export interface GlobalMemberItem { name: string; detail: string; doc: string; kind: 'method' | 'property' | 'field'; }
export interface RangeItem { line: number; column0: number; length: number; }
