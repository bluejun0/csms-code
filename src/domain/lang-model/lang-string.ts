import { SourceLocation } from '../shared/value-objects';

export interface LangEntry { value: string; location: SourceLocation; }
export interface LangString { key: string; ko?: LangEntry; en?: LangEntry; }
