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
