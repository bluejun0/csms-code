import { strict as assert } from 'assert';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';

describe('ScopeTable', () => {
  const table = ScopeTable.of([
    { start: 0, end: 100 },
    { start: 10, end: 20 },
    { start: 30, end: 60 },
    { start: 40, end: 50 },
  ], 200);

  it('가장 안쪽 구간을 준다', () => {
    assert.deepEqual(table.at(45), { start: 40, end: 50 });
  });
  it('안쪽 구간 밖이면 바깥 구간으로 올라간다', () => {
    assert.deepEqual(table.at(55), { start: 30, end: 60 });
    assert.deepEqual(table.at(25), { start: 0, end: 100 });
  });
  it('어느 구간에도 없으면 문서 전체', () => {
    assert.deepEqual(table.at(150), { start: 0, end: 200 });
  });
  it('구간 시작 위치는 그 구간에 든다', () => {
    assert.deepEqual(table.at(40), { start: 40, end: 50 });
  });
  it('구간이 없으면 언제나 문서 전체', () => {
    assert.deepEqual(ScopeTable.of([], 80).at(5), { start: 0, end: 80 });
  });
  it('시작이 같은 두 구간은 바깥이 앞선다 — 안쪽만 포함하는 위치는 안쪽을, 바깥만 포함하는 위치는 바깥을 돌려준다', () => {
    const tied = ScopeTable.of([
      { start: 0, end: 5 },  // 안쪽 — 입력 순서상 바깥보다 먼저 온다
      { start: 0, end: 10 }, // 바깥
    ], 20);
    assert.deepEqual(tied.at(3), { start: 0, end: 5 });
    assert.deepEqual(tied.at(7), { start: 0, end: 10 });
  });
});
