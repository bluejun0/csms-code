import { strict as assert } from 'assert';
import { join } from 'path';
import { PhpUsageIndex, isIndexableSourcePath } from '../../../src/infrastructure/usage/php-usage-index';

const root = join(__dirname, '../../fixtures/mini-moodle');
// 픽스처 기준 canonical 존재 판정: 코어 서브시스템은 core_grades뿐
const hasCanonical = (c: string) => ['core', 'core_grades', 'local_ubattend', 'mod_testmod'].includes(c);

describe('PhpUsageIndex', () => {
  const idx = new PhpUsageIndex(hasCanonical);
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
    assert.equal(refs.length, 2, 'PHP 1건 + JS 1건');
    assert.equal(refs.filter(r => r.uri.endsWith('view.php')).length, 1, 'PHP 파일에서 정확히 1건(중복 추출 방지)');
    const phpRef = refs.find(r => r.uri.endsWith('local/ubattend/view.php'));
    assert.ok(phpRef, 'PHP 파일의 참조가 있어야 함');
    assert.equal(phpRef.line, 1);        // 0-based — 2번째 줄
    assert.equal(phpRef.column, 17);     // "echo get_string('" 다음 = 키 시작
  });
  it("레거시 bare component('testmod')는 mod_testmod로 canonical 귀속", () => {
    assert.equal(idx.referencesOf('mod_testmod', 'pluginname').length, 1);
    assert.equal(idx.referencesOf('testmod', 'pluginname').length, 0, '조회는 canonical만');
  });
  it("한 인자 호출은 core 귀속", () => {
    assert.equal(idx.referencesOf('core', 'ok').length, 1);
  });
  it('변수 키 호출은 미포착', () => {
    // view.php에는 local_ubattend 대상 get_string이 2건($dynamic 포함) 있지만 리터럴 1건만 잡혀야 한다
    const fromPhp = idx.referencesOf('local_ubattend', 'attendance_book')
      .filter(r => r.uri.endsWith('view.php'));
    assert.equal(fromPhp.length, 1, '리터럴 호출 1건만');
    assert.equal(fromPhp[0].line, 1, '$dynamic 줄(4)이 아니라 리터럴 줄(1)');
  });
  it('updateFileText: 항목 교체·제거(증분)', () => {
    const uri = join(root, 'local/ubattend/view.php');
    idx.updateFileText(uri, "<?php\necho get_string('attendance_rate', 'local_ubattend');\n");
    // PHP 파일의 attendance_book 제거 후 JS 파일의 것만 남아야 함
    const bookRefs = idx.referencesOf('local_ubattend', 'attendance_book');
    assert.equal(bookRefs.length, 1, 'PHP 것만 제거되고 JS 것 1건만 남아야 함');
    assert.ok(bookRefs[0].uri.includes(join('amd', 'src')), '남은 1건은 JS 파일');
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_rate').length, 1, '새 항목 반영');
    idx.updateFileText(uri, '<?php\n');
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_rate').length, 0, 'PHP 파일의 항목 제거');
  });
  it("키 'string'(get_string 접두부와 충돌)의 컬럼도 정확", () => {
    const idx2 = new PhpUsageIndex(() => false);
    idx2.updateFileText('/x.php', "<?php\necho get_string('string', 'local_ubattend');\n");
    const refs = idx2.referencesOf('local_ubattend', 'string');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].column, 17);
  });
  it("lang 디렉터리는 스캔에서 제외 — 값/노트 속 get_string 유령 매치 방지", () => {
    assert.equal(idx.referencesOf('local_ubattend', 'ghost_key').length, 0);
  });
  it('isIndexableSourcePath: 스캔 제외 규칙과 패리티', () => {
    assert.equal(isIndexableSourcePath(root, join(root, 'local/ubattend/view.php')), true);
    assert.equal(isIndexableSourcePath(root, join(root, 'local/ubattend/lang/en/local_ubattend.php')), false);
    assert.equal(isIndexableSourcePath(root, join(root, 'vendor/x.php')), false);
    assert.equal(isIndexableSourcePath(root, '/etc/x.php'), false);
    assert.equal(isIndexableSourcePath(root, join(root, 'local/a.txt')), false);
    assert.equal(isIndexableSourcePath(root, join(root, 'local/ubattend/amd/src/view.js')), true);
    assert.equal(isIndexableSourcePath(root, join(root, 'local/ubattend/amd/build/view.min.js')), false);
    assert.equal(isIndexableSourcePath(root, join(root, 'local/ubattend/amd/build/view.js')), false);
  });
});

describe('PhpUsageIndex — 템플릿 참조(같은 스캔에서 수집)', () => {
  const tidx = new PhpUsageIndex(() => false);
  before(async () => { await tidx.buildFromRoot(root); });

  it('render_from_template 사용처를 component/name으로 조회', () => {
    const refs = tidx.templateRefsOf('local_ubattend', 'setting');
    assert.ok(refs.length >= 1, 'PHP와 JS에서 최소 1개 이상');
    assert.ok(refs.some(r => r.uri.endsWith('local/ubattend/view.php')), 'PHP 파일의 참조가 있어야 함');
  });
  it('하위 경로 이름도 조회', () =>
    assert.equal(tidx.templateRefsOf('local_ubattend', 'svg/icon/hyflex').length, 1));
  it('한 번의 스캔이 문자열·템플릿 색인을 모두 채운다', () => {
    assert.ok(tidx.referencesOf('local_ubattend', 'attendance_book').length >= 1, '문자열 참조 최소 1건');
    assert.ok(tidx.templateRefsOf('local_ubattend', 'setting').length >= 1, '템플릿 참조 최소 1건');
  });
  it('증분 교체가 두 색인 모두에 반영', () => {
    const uri = join(root, 'local/ubattend/view.php');
    tidx.updateFileText(uri, "<?php\necho $OUTPUT->render_from_template('local_ubattend/other', []);\n");
    // PHP 파일의 'setting' 제거 후 JS 파일의 것만 남아야 함
    const settingRefs = tidx.templateRefsOf('local_ubattend', 'setting');
    assert.ok(!settingRefs.some(r => r.uri.endsWith('view.php')), 'PHP 파일의 setting 참조 제거됨');
    assert.ok(settingRefs.some(r => r.uri.includes('amd/src')), 'JS 파일의 setting은 남음');
    assert.equal(tidx.templateRefsOf('local_ubattend', 'other').length, 1, '새 참조 반영');
    // PHP 파일의 attendance_book 제거 후 JS 파일의 것만 남아야 함
    const bookRefs = tidx.referencesOf('local_ubattend', 'attendance_book');
    assert.ok(!bookRefs.some(r => r.uri.endsWith('view.php')), 'PHP 파일의 attendance_book 제거됨');
    assert.ok(bookRefs.some(r => r.uri.includes('amd/src')), 'JS 파일의 attendance_book은 남음');
  });
});

describe('PhpUsageIndex — JS 사용처(같은 스캔에서 수집)', () => {
  const jidx = new PhpUsageIndex(() => false);
  before(async () => { await jidx.buildFromRoot(root); });

  it('JS의 get_string 호출이 참조로 잡힘', () => {
    const refs = jidx.referencesOf('local_ubattend', 'attendance_book');
    assert.ok(refs.some(r => r.uri.endsWith(join('amd', 'src', 'view.js'))), 'amd/src의 JS 호출이 포함돼야 함');
  });
  it('JS의 Templates.render 호출이 템플릿 참조로 잡힘', () => {
    const refs = jidx.templateRefsOf('local_ubattend', 'setting');
    assert.ok(refs.some(r => r.uri.endsWith(join('amd', 'src', 'view.js'))));
  });
  it('amd/build 사본은 색인되지 않음(중복 0)', () => {
    const all = [...jidx.referencesOf('local_ubattend', 'attendance_book'),
                 ...jidx.templateRefsOf('local_ubattend', 'setting')];
    assert.equal(all.filter(r => r.uri.includes(join('amd', 'build'))).length, 0);
  });
  it('JS 파일 증분 교체', () => {
    const uri = join(root, 'local/ubattend/amd/src/view.js');
    jidx.updateFileText(uri, "str.get_string('other_key', 'local_ubattend');\n");
    assert.equal(jidx.referencesOf('local_ubattend', 'other_key').length, 1);
    assert.ok(!jidx.referencesOf('local_ubattend', 'attendance_book').some(r => r.uri.endsWith('view.js')));
    assert.equal(jidx.templateRefsOf('local_ubattend', 'setting').filter(r => r.uri.endsWith('view.js')).length, 0);
  });
});

describe('PhpUsageIndex — js_call_amd 사용처', () => {
  const CODE = `<?php\n$PAGE->requires->js_call_amd('local_x/mod', 'init');\n`;

  it('위치와 함께 담고, 같은 파일 재갱신에 중복되지 않는다', () => {
    const idx = new PhpUsageIndex(() => true);
    const uri = '/w/local/x/index.php';
    idx.updateFileText(uri, CODE);
    const refs = idx.amdRefsOf('local_x', 'mod');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].line, 1);
    const line = CODE.split('\n')[1];
    assert.equal(line.slice(refs[0].column, refs[0].column + 'local_x/mod'.length), 'local_x/mod');
    idx.updateFileText(uri, CODE);
    assert.equal(idx.amdRefsOf('local_x', 'mod').length, 1);
  });

  it('참조가 사라지면 목록에서 빠진다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/w/a.php', CODE);
    idx.updateFileText('/w/a.php', '<?php\n');
    assert.equal(idx.amdRefsOf('local_x', 'mod').length, 0);
  });

  it('JS 파일에서는 수집하지 않는다(모듈 로딩은 import·require)', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/w/amd/src/a.js', "require(['local_x/mod'], function () {});\n");
    assert.equal(idx.amdRefsOf('local_x', 'mod').length, 0);
  });
});
