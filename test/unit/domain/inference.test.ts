import { strict as assert } from 'assert';
import { RecordTypeInference } from '../../../src/domain/code-analysis/record-type-inference';
import { DocumentFacts } from '../../../src/domain/code-analysis/facts';

const S = { start: 0, end: 1000 };
const base: DocumentFacts = { assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [], propertyAccesses: [] };
const known = (t: string) => ['user', 'assign', 'local_ubattend_config', 'local_ubattend_log'].includes(t);
const inf = new RecordTypeInference();

describe('RecordTypeInference', () => {
  it('get_record 대입 → 테이블 바인딩', () => {
    const f = { ...base, assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }] };
    assert.deepEqual(inf.infer(f, 'u', 50, S, known), { varName: 'u', tableName: 'user', source: 'assignment' });
  });
  it('get_record_sql(리터럴 없음) → null', () => {
    const f = { ...base, assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record_sql', tableArg: null, index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'u', 50, S, known), null);
  });
  it('대입이 커서 뒤면 무시(직전만)', () => {
    const f = { ...base, assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 90, scope: S }] };
    assert.equal(inf.infer(f, 'u', 50, S, known), null);
  });
  it('foreach: 컬렉션 테이블 → 항목 바인딩', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'local_ubattend_log', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rows', itemVar: 'r', index: 20, scope: S }] };
    assert.deepEqual(inf.infer(f, 'r', 50, S, known), { varName: 'r', tableName: 'local_ubattend_log', source: 'foreach' });
  });
  it('dataarg: 스코프 전역(사용이 접근 뒤여도)', () => {
    const f = { ...base, dataArgBindings: [{ method: 'insert_record', tableArg: 'local_ubattend_config', dataVar: 'data', index: 90, scope: S }] };
    assert.deepEqual(inf.infer(f, 'data', 50, S, known), { varName: 'data', tableName: 'local_ubattend_config', source: 'dataarg' });
  });
  it('dataarg: 동일 변수명이 서로 다른 테이블을 가리키면 모호 → null(오탐 방지)', () => {
    const f = { ...base, dataArgBindings: [
      { method: 'insert_record', tableArg: 'local_ubattend_config', dataVar: 'data', index: 10, scope: S },
      { method: 'update_record', tableArg: 'local_ubattend_log', dataVar: 'data', index: 90, scope: S },
    ] };
    assert.equal(inf.infer(f, 'data', 50, S, known), null);
  });
  it('dataarg: 동일 변수명이 같은 테이블을 여러 번 가리키면 모호 아님 → 바인딩', () => {
    const f = { ...base, dataArgBindings: [
      { method: 'insert_record', tableArg: 'local_ubattend_config', dataVar: 'data', index: 10, scope: S },
      { method: 'update_record', tableArg: 'local_ubattend_config', dataVar: 'data', index: 90, scope: S },
    ] };
    assert.deepEqual(inf.infer(f, 'data', 50, S, known), { varName: 'data', tableName: 'local_ubattend_config', source: 'dataarg' });
  });
  it('phpdoc 테이블 타입이 대입보다 우선', () => {
    const f = { ...base,
      phpdocVars: [{ varName: 'u', typeText: 'assign', index: 5, scope: S }],
      assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'u', 50, S, known)!.source, 'phpdoc');
  });
  it('bare stdClass phpdoc는 바인딩 아님(대입으로 폴백)', () => {
    const f = { ...base,
      phpdocVars: [{ varName: 'u', typeText: '\\stdClass', index: 5, scope: S }],
      assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'u', 50, S, known)!.source, 'assignment');
  });
  it('스코프 격리: 다른 함수 스코프의 대입은 건너오지 않음 → null', () => {
    const scopeA = { start: 0, end: 100 };
    const scopeB = { start: 200, end: 300 };
    const f = { ...base,
      assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: scopeA }] };
    assert.equal(inf.infer(f, 'u', 250, scopeB, known), null);
  });
});
