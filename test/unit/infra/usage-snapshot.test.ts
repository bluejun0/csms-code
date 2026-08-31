import { strict as assert } from 'assert';
import { SNAPSHOT_VERSION, UsageSnapshot, diffStamps, isSnapshotUsable, packRows, unpackRows } from '../../../src/infrastructure/usage/usage-snapshot';

const snap: UsageSnapshot = { v: SNAPSHOT_VERSION, ext: '1.2.3', root: '/m', files: [], s: [], t: [], a: [], c: [] };

describe('isSnapshotUsable', () => {
  it('버전·확장 버전·루트가 모두 맞으면 쓸 수 있다', () =>
    assert.equal(isSnapshotUsable(snap, '/m', '1.2.3'), true));
  it('형식 버전이 다르면 버린다', () =>
    assert.equal(isSnapshotUsable({ ...snap, v: SNAPSHOT_VERSION + 1 }, '/m', '1.2.3'), false));
  it('확장 버전이 다르면 버린다 — 추출 규칙이 바뀌었을 수 있다', () =>
    assert.equal(isSnapshotUsable({ ...snap, ext: '1.2.2' }, '/m', '1.2.3'), false));
  it('루트가 다르면 버린다', () => assert.equal(isSnapshotUsable(snap, '/other', '1.2.3'), false));
  it('형태가 아니면 버린다(널·필드 누락·배열 아님)', () => {
    assert.equal(isSnapshotUsable(null, '/m', '1.2.3'), false);
    assert.equal(isSnapshotUsable({ v: SNAPSHOT_VERSION, ext: '1.2.3', root: '/m' }, '/m', '1.2.3'), false);
    assert.equal(isSnapshotUsable({ ...snap, files: 'x' }, '/m', '1.2.3'), false);
  });
});

describe('diffStamps', () => {
  const cached: [string, number, number][] = [['a.php', 100, 10], ['b.php', 100, 10], ['gone.php', 100, 10]];
  const current: [string, number, number][] = [['a.php', 100, 10], ['b.php', 200, 10], ['new.php', 100, 10]];
  it('mtime이 다르면 changed, 현재에만 있으면 changed, 캐시에만 있으면 removed', () => {
    const d = diffStamps(cached, current);
    assert.deepEqual(d.changed.sort(), ['b.php', 'new.php']);
    assert.deepEqual(d.removed, ['gone.php']);
  });
  it('size만 달라도 changed', () =>
    assert.deepEqual(diffStamps([['a.php', 100, 10]], [['a.php', 100, 11]]).changed, ['a.php']));
  it('도장이 "모름"(size 음수)이면 changed', () =>
    assert.deepEqual(diffStamps([['a.php', 0, -1]], [['a.php', 100, 10]]).changed, ['a.php']));
  it('같으면 아무것도 없다', () =>
    assert.deepEqual(diffStamps(cached, cached), { changed: [], removed: [] }));
});

describe('packRows·unpackRows 왕복', () => {
  it('파일별 목록을 평평하게 담고 되돌린다', () => {
    const flat = packRows<[string, number]>([[0, [['k1', 7], ['k2', 8]]], [3, [['k3', 9]]]], e => [e[0], e[1]]);
    const seen: [number, string, number][] = [];
    unpackRows(flat, 2, (fi, row) => seen.push([fi, row[0] as string, row[1] as number]));
    assert.deepEqual(seen, [[0, 'k1', 7], [0, 'k2', 8], [3, 'k3', 9]]);
  });
  it('빈 목록은 아무것도 남기지 않는다', () =>
    assert.deepEqual(packRows<[string]>([[1, []]], e => [e[0]]), []));
});

describe('unpackRows — 못 믿을 입력 방어', () => {
  it('셀이 모자라면 그 묶음을 통째로 버린다', () => {
    const seen: unknown[] = [];
    unpackRows([0, 2, 'k1', 1, 'k2'], 2, (fi, row) => seen.push([fi, ...row]));
    assert.deepEqual(seen, [], '반쪽 묶음은 믿지 않는다');
  });
  it('온전한 묶음은 그대로 적용한다', () => {
    const seen: unknown[] = [];
    unpackRows([0, 2, 'k1', 1, 'k2', 2], 2, (fi, row) => seen.push([fi, ...row]));
    assert.deepEqual(seen, [[0, 'k1', 1], [0, 'k2', 2]]);
  });
  it('개수가 배열 길이를 넘으면 그 묶음을 버린다(거대한 n으로 도지 않는다)', () => {
    let calls = 0;
    unpackRows([0, 5_000_000, 'k', 1], 2, () => { calls++; });
    assert.equal(calls, 0);
  });
  it('개수·파일 인덱스가 정수가 아니거나 음수면 버린다', () => {
    let calls = 0;
    unpackRows([0, -1, 'k', 1], 2, () => { calls++; });
    unpackRows([0, '2' as unknown as number, 'k', 1], 2, () => { calls++; });
    unpackRows(['x' as unknown as number, 1, 'k', 1], 2, () => { calls++; });
    assert.equal(calls, 0);
  });
});
