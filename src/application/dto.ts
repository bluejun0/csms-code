import { SourceLocation } from '../domain/shared/value-objects';
export interface ColumnItem { name: string; type: string; comment: string; }
export interface StringItem { key: string; ko?: string; en?: string; }
export interface DefinitionResult { location: SourceLocation; }
export interface HoverResult { markdown: string; }
export interface DiagnosticItem { line: number; column0: number; length: number; message: string; suggestion?: string; }
export interface RangeItem { line: number; column0: number; length: number; }
