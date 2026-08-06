import { strict as assert } from 'assert';
import { join } from 'path';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';

const root = join(__dirname, '../../fixtures/mini-moodle');
const store = new StringIndexStore();
store.buildFromRoot(root); // 동기 — 모듈 로드 시 1회 (최상위 before()는 mocha 전역 루트 훅이 되므로 금지)

describe('StringIndexStore', () => {
  it('ko/en 병합: 같은 키에 두 locale', () => {
    const s = store.getString('local_ubattend', 'attendance_book')!;
    assert.equal(s.ko!.value, '출석부');
    assert.equal(s.en!.value, 'Attendance book');
    assert.ok(s.ko!.location.uri.endsWith('lang/ko/local_ubattend.php'));
  });
  it('en만 있는 키', () => {
    const s = store.getString('local_ubattend', 'attendance_rate')!;
    assert.equal(s.en!.value, 'Attendance rate');
    assert.equal(s.ko, undefined);
  });
  it("정규화: ''/'moodle'/'core' → 코어", () => {
    for (const c of ['', 'moodle', 'core']) assert.equal(store.getString(c, 'ok')!.en!.value, 'OK');
  });
  it('mod 컴포넌트 + 레거시 단축(bare) 해석', () => {
    assert.equal(store.getString('mod_testmod', 'pluginname')!.en!.value, 'Test module');
    assert.equal(store.getString('testmod', 'pluginname')!.en!.value, 'Test module'); // bare → mod_testmod
  });
  it('bare 이름이 코어 서브시스템이면 core_<s> 우선(mod 폴백 아님)', () => {
    assert.equal(store.getString('grades', 'gradebook')!.en!.value, 'Gradebook');
    assert.equal(store.getString('core_grades', 'gradebook')!.en!.value, 'Gradebook');
  });
  it('hasComponent: 색인된 것만 true', () => {
    assert.equal(store.hasComponent('local_ubattend'), true);
    assert.equal(store.hasComponent('local_nope'), false);
  });
  it('keysOf: 컴포넌트의 전체 키(병합 후)', () => {
    const keys = store.keysOf('local_ubattend').map(s => s.key).sort();
    assert.deepEqual(keys, ['attendance_book', 'attendance_rate']);
  });
});

describe('StringIndexStore — 비동기 빌드·증분', () => {
  const ubKo = join(root, 'local/ubattend/lang/ko/local_ubattend.php');

  it('async 빌드가 sync와 동일 결과', async () => {
    const a = new StringIndexStore(); a.buildFromRoot(root);
    const b = new StringIndexStore(); await b.buildFromRootAsync(root);
    const dump = (s: StringIndexStore) => s.keysOf('local_ubattend')
      .map(x => `${x.key}|${x.ko?.value ?? ''}|${x.en?.value ?? ''}`).sort();
    assert.deepEqual(dump(b), dump(a));
    assert.equal(b.getString('core', 'ok')!.en!.value, a.getString('core', 'ok')!.en!.value);
  });
  it('진행률 콜백이 최소 1회 호출되고 done ≤ total', async () => {
    const s = new StringIndexStore();
    const calls: [number, number][] = [];
    await s.buildFromRootAsync(root, (d, t) => calls.push([d, t]));
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(([d, t]) => d <= t));
  });
  it('removeFile: 해당 locale만 사라지고 en은 남는다', async () => {
    const s = new StringIndexStore(); await s.buildFromRootAsync(root);
    assert.ok(s.getString('local_ubattend', 'attendance_book')!.ko, '사전 조건: ko 존재');
    s.removeFile(ubKo);
    const after = s.getString('local_ubattend', 'attendance_book')!;
    assert.equal(after.ko, undefined, 'ko 제거');
    assert.ok(after.en, 'en은 유지');
  });
  it('removeFile: 두 locale 모두 사라진 키는 제거된다', async () => {
    const s = new StringIndexStore(); await s.buildFromRootAsync(root);
    s.removeFile(ubKo);
    s.removeFile(join(root, 'local/ubattend/lang/en/local_ubattend.php'));
    assert.equal(s.getString('local_ubattend', 'attendance_book'), undefined);
    assert.equal(s.hasComponent('local_ubattend'), false, '빈 컴포넌트 맵도 제거');
  });
  it('증분(update)이 전체 재빌드와 같은 상태로 수렴', async () => {
    const s = new StringIndexStore(); await s.buildFromRootAsync(root);
    s.removeFile(ubKo);
    s.updateFile(ubKo, 'local_ubattend', 'ko');
    const full = new StringIndexStore(); await full.buildFromRootAsync(root);
    const dump = (x: StringIndexStore) => x.keysOf('local_ubattend')
      .map(v => `${v.key}|${v.ko?.value ?? ''}|${v.en?.value ?? ''}`).sort();
    assert.deepEqual(dump(s), dump(full));
  });
});
