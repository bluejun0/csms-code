import { ServiceImplementationRef } from './service-implementation-finder';

export interface TextSpan { line: number; column0: number; length: number; }

export interface DeclaredServiceImplementation extends Omit<ServiceImplementationRef, 'component'> {
  name: string;
  classnameSpan: TextSpan | null;
  methodnameSpan: TextSpan | null;
}

export interface ServiceDeclarationReader {
  implementationsIn(text: string): DeclaredServiceImplementation[];
}
