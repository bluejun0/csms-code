import { SourceLocation } from '../domain/shared/value-objects';
export interface ColumnItem { name: string; type: string; comment: string; }
export interface StringItem { key: string; ko?: string; en?: string; }
export interface DefinitionResult { location: SourceLocation; }
export interface HoverResult { markdown: string; }
export type DiagnosticKind = 'column' | 'string';
export interface DiagnosticItem { kind: DiagnosticKind; line: number; column0: number; length: number; message: string; suggestion?: string; }
export interface GlobalMemberItem { name: string; detail: string; doc: string; kind: 'method' | 'property' | 'field'; }
export interface RangeItem { line: number; column0: number; length: number; }
