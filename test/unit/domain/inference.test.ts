import { strict as assert } from 'assert';
import { RecordTypeInference } from '../../../src/domain/code-analysis/record-type-inference';
import { DocumentFacts } from '../../../src/domain/code-analysis/facts';

const S = { start: 0, end: 1000 };
const base: DocumentFacts = { assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [], propertyAccesses: [], plainAssignments: [], stringCalls: [] };
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

  // ---- kill-on-reassign (스펙 2026-07-31) ----
  it('kill: 레코드 대입 후 일반 재대입 → null (대표 오탐 시나리오)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rec', index: 10, scope: S }, { varName: 'rec', index: 30, scope: S }] };
    assert.equal(inf.infer(f, 'rec', 50, S, known), null);
  });
  it('kill 후 재차 레코드 대입 → 재바인딩', () => {
    const f = { ...base,
      assignments: [
        { varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S },
        { varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'assign', index: 40, scope: S }],
      plainAssignments: [
        { varName: 'rec', index: 10, scope: S }, { varName: 'rec', index: 30, scope: S }, { varName: 'rec', index: 40, scope: S }] };
    assert.deepEqual(inf.infer(f, 'rec', 60, S, known), { varName: 'rec', tableName: 'assign', source: 'assignment' });
  });
  it('foreach 항목이 앞선 레코드 대입보다 가까우면 foreach 승리(가림 버그 수정)', () => {
    const f = { ...base,
      assignments: [
        { varName: 'r', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S },
        { varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'local_ubattend_log', index: 20, scope: S }],
      foreachBindings: [{ collectionVar: 'rows', itemVar: 'r', index: 30, scope: S }],
      plainAssignments: [{ varName: 'r', index: 10, scope: S }, { varName: 'rows', index: 20, scope: S }] };
    assert.deepEqual(inf.infer(f, 'r', 50, S, known), { varName: 'r', tableName: 'local_ubattend_log', source: 'foreach' });
  });
  it('foreach 항목 사용 후 재대입 → kill', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'user', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rows', itemVar: 'r', index: 20, scope: S }],
      plainAssignments: [{ varName: 'rows', index: 10, scope: S }, { varName: 'r', index: 40, scope: S }] };
    assert.equal(inf.infer(f, 'r', 60, S, known), null);
  });
  it('phpdoc @var은 후속 일반 대입에도 생존(절대 우선)', () => {
    const f = { ...base,
      phpdocVars: [{ varName: 'rec', typeText: 'user', index: 5, scope: S }],
      plainAssignments: [{ varName: 'rec', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rec', 50, S, known)!.source, 'phpdoc');
  });
  it('dataarg는 new stdClass kill에도 생존', () => {
    const f = { ...base,
      plainAssignments: [{ varName: 'data', index: 10, scope: S }],
      dataArgBindings: [{ method: 'insert_record', tableArg: 'local_ubattend_config', dataVar: 'data', index: 90, scope: S }] };
    assert.deepEqual(inf.infer(f, 'data', 50, S, known), { varName: 'data', tableName: 'local_ubattend_config', source: 'dataarg' });
  });
  it('컬렉션 재대입 후 foreach → 항목 바인딩 없음', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'user', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rows', itemVar: 'r', index: 40, scope: S }],
      plainAssignments: [{ varName: 'rows', index: 10, scope: S }, { varName: 'rows', index: 20, scope: S }] };
    assert.equal(inf.infer(f, 'r', 60, S, known), null);
  });
  it('다른 스코프의 일반 대입은 kill 아님(sameScope 가드)', () => {
    const scopeA = { start: 0, end: 100 }; const scopeB = { start: 20, end: 40 }; // 중첩 클로저 스코프
    const f = { ...base,
      assignments: [{ varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: scopeA }],
      plainAssignments: [{ varName: 'rec', index: 10, scope: scopeA }, { varName: 'rec', index: 30, scope: scopeB }] };
    assert.deepEqual(inf.infer(f, 'rec', 50, scopeA, known), { varName: 'rec', tableName: 'user', source: 'assignment' });
  });

  // ---- 컬렉션 직접 바인딩 제거 (스펙 2026-08-04) ----
  it('get_recordset 직접 대입 → null (recordset 객체는 레코드가 아님)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rs', receiver: 'DB', method: 'get_recordset', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rs', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rs', 50, S, known), null);
  });
  it('get_recordset_select 직접 대입 → null', () => {
    const f = { ...base,
      assignments: [{ varName: 'rs', receiver: 'DB', method: 'get_recordset_select', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rs', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rs', 50, S, known), null);
  });
  it('get_records 직접 대입 → null (배열 변수는 레코드가 아님)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rows', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rows', 50, S, known), null);
  });
  it('get_records_select 직접 대입 → null (컬렉션 4개 대칭 커버)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records_select', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rows', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rows', 50, S, known), null);
  });
  it('foreach over get_recordset → 항목은 바인딩', () => {
    const f = { ...base,
      assignments: [{ varName: 'rs', receiver: 'DB', method: 'get_recordset', tableArg: 'local_ubattend_log', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rs', itemVar: 'r', index: 20, scope: S }],
      plainAssignments: [{ varName: 'rs', index: 10, scope: S }] };
    assert.deepEqual(inf.infer(f, 'r', 50, S, known), { varName: 'r', tableName: 'local_ubattend_log', source: 'foreach' });
  });
  it('foreach over get_record(단일 레코드) → 항목 바인딩 없음 (필드 값 순회)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rec', itemVar: 'v', index: 20, scope: S }],
      plainAssignments: [{ varName: 'rec', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'v', 50, S, known), null);
  });
});
