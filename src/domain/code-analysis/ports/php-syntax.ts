import { DocumentFacts } from '../facts';

/** 클래스 본문에서 뽑은 멤버 하나 — 이름·종류·시그니처·설명과 선언 위치(0-based 줄·컬럼). */
export interface RawClassMember {
  name: string; kind: 'method' | 'property';
  signature: string; doc: string;
  line: number; column: number;
}

export interface PhpSyntax {
  facts(text: string): DocumentFacts;
  /** 지정한 클래스 본문의 public 멤버. 클래스가 없으면 빈 배열. */
  classMembers(text: string, className: string): RawClassMember[];
}
