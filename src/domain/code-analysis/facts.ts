export interface Scope { start: number; end: number; }
export interface RecordAssignment { varName: string; receiver: string; method: string; tableArg: string | null; index: number; scope: Scope; }
export interface ForeachBinding { collectionVar: string; itemVar: string; index: number; scope: Scope; }
export interface DataArgBinding { method: string; tableArg: string; dataVar: string; index: number; scope: Scope; }
export interface PhpdocVar { varName: string; typeText: string; index: number; scope: Scope; }
export interface PropertyAccess { varName: string; property: string; propLine: number; propColumn: number; propIndex: number; index: number; scope: Scope; }
export interface DocumentFacts {
  assignments: RecordAssignment[];
  foreachBindings: ForeachBinding[];
  dataArgBindings: DataArgBinding[];
  phpdocVars: PhpdocVar[];
  propertyAccesses: PropertyAccess[];
}
