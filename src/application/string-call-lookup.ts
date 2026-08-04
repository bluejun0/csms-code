import { DocumentFacts, StringCall } from '../domain/code-analysis/facts';

/** 커서가 get_string의 key 리터럴 내용 범위 안에 있는 호출 */
export function findStringCallAt(facts: DocumentFacts, atIndex: number): StringCall | undefined {
  return facts.stringCalls.find(c => c.keyIndex <= atIndex && atIndex <= c.keyIndex + c.key.length);
}
