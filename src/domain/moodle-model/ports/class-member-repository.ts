import { SourceLocation } from '../../shared/value-objects';

export interface ClassMember {
  name: string;
  kind: 'method' | 'property';
  signature: string;
  doc: string;
  location: SourceLocation;
}

export interface ClassMemberRepository {
  membersOf(className: string): ClassMember[];
}
