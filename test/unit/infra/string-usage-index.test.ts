import { strict as assert } from 'assert';
import { join } from 'path';
import { StringUsageIndex, isIndexablePhpPath } from '../../../src/infrastructure/lang/string-usage-index';

const root = join(__dirname, '../../fixtures/mini-moodle');
// 픽스처 기준 canonical 존재 판정: 코어 서브시스템은 core_grades뿐
const hasCanonical = (c: string) => ['core', 'core_grades', 'local_ubattend', 'mod_testmod'].includes(c);

describe('StringUsageIndex', () => {
  const idx = new StringUsageIndex(hasCanonical);
  let progressed = 0;
  before(async function () {
    assert.equal(idx.isBuilt, false, '빌드 전 isBuilt=false');
    await idx.buildFromRoot(root, () => { progressed++; });
    // mocha 최상위 before 금지 규칙과 무관 — describe 내부 before
  });

  it('빌드 후 isBuilt=true + 진행률 콜백 호출', () => {
    assert.equal(idx.isBuilt, true);
    assert.ok(progressed >= 1, '최소 1회(완료 시점) 호출');
  });
  it('canonical 호출: 위치(줄·컬럼) 정확', () => {
    const refs = idx.referencesOf('local_ubattend', 'attendance_book');
    assert.equal(refs.length, 1);
    assert.ok(refs[0].uri.endsWith('local/ubattend/view.php'));
    assert.equal(refs[0].line, 1);        // 0-based — 2번째 줄
    assert.equal(refs[0].column, 17);     // "echo get_string('" 다음 = 키 시작
  });
  it("레거시 bare component('testmod')는 mod_testmod로 canonical 귀속", () => {
    assert.equal(idx.referencesOf('mod_testmod', 'pluginname').length, 1);
    assert.equal(idx.referencesOf('testmod', 'pluginname').length, 0, '조회는 canonical만');
  });
  it("한 인자 호출은 core 귀속", () => {
    assert.equal(idx.referencesOf('core', 'ok').length, 1);
  });
  it('변수 키 호출은 미포착', () => {
    // view.php의 local_ubattend 호출은 attendance_book 1건뿐($dynamic은 비포착)
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_book').length, 1);
  });
  it('updateFileText: 항목 교체·제거(증분)', () => {
    const uri = join(root, 'local/ubattend/view.php');
    idx.updateFileText(uri, "<?php\necho get_string('attendance_rate', 'local_ubattend');\n");
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_book').length, 0, '이전 항목 제거');
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_rate').length, 1, '새 항목 반영');
    idx.updateFileText(uri, '<?php\n');
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_rate').length, 0, '전부 제거');
  });
  it("키 'string'(get_string 접두부와 충돌)의 컬럼도 정확", () => {
    const idx2 = new StringUsageIndex(() => false);
    idx2.updateFileText('/x.php', "<?php\necho get_string('string', 'local_ubattend');\n");
    const refs = idx2.referencesOf('local_ubattend', 'string');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].column, 17);
  });
  it("lang 디렉터리는 스캔에서 제외 — 값/노트 속 get_string 유령 매치 방지", () => {
    assert.equal(idx.referencesOf('local_ubattend', 'ghost_key').length, 0);
  });
  it('isIndexablePhpPath: 스캔 제외 규칙과 패리티', () => {
    assert.equal(isIndexablePhpPath(root, join(root, 'local/ubattend/view.php')), true);
    assert.equal(isIndexablePhpPath(root, join(root, 'local/ubattend/lang/en/local_ubattend.php')), false);
    assert.equal(isIndexablePhpPath(root, join(root, 'vendor/x.php')), false);
    assert.equal(isIndexablePhpPath(root, '/etc/x.php'), false);
    assert.equal(isIndexablePhpPath(root, join(root, 'local/a.txt')), false);
  });
});
