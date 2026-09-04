import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
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
  it("print_string도 사용처로 잡힌다(컬럼은 키 시작)", () => {
    const idx2 = new PhpUsageIndex(() => false);
    idx2.updateFileText('/p.php', "<?php\nprint_string('attendance_book', 'local_ubattend');\n");
    const refs = idx2.referencesOf('local_ubattend', 'attendance_book');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].line, 1);
    assert.equal(refs[0].column, 14); // "print_string('" 다음 = 키 시작
  });
  it("print_error·new \\moodle_exception도 사용처로 잡히고, 컴포넌트가 변수인 호출은 core로 오귀속되지 않는다", () => {
    const idx2 = new PhpUsageIndex(c => ['core_error', 'local_ubattend'].includes(c));
    idx2.updateFileText('/e.php', "<?php\nprint_error('nocode');\nthrow new \\moodle_exception('excode', 'local_ubattend');\necho get_string('dyn', $comp);\n");
    const e = idx2.referencesOf('core_error', 'nocode');
    assert.equal(e.length, 1, 'print_error 한 인자 → core_error');
    assert.equal(e[0].column, 13); // "print_error('" 다음
    const x = idx2.referencesOf('local_ubattend', 'excode');
    assert.equal(x.length, 1);
    assert.equal(x[0].column, 29); // "throw new \\moodle_exception('" 다음
    assert.equal(idx2.referencesOf('core', 'dyn').length, 0, '컴포넌트가 리터럴이 아니면 침묵');
  });
  it('설정 참조: get_config·set_config 키 위치, 값에 괄호가 든 set_config는 침묵, 증분 제거', () => {
    const idx2 = new PhpUsageIndex(() => false);
    const src = "<?php\n$a = get_config('local_ubattend', 'apikey');\nset_config('mode', 1, 'local_ubattend');\nset_config('nest', get_config('a', 'b'), 'local_ubattend');\nset_config('core_only', 1);\n";
    idx2.updateFileText('/c.php', src);
    const lines = src.split('\n');
    const get = idx2.configRefsOf('local_ubattend', 'apikey');
    assert.equal(get.length, 1); assert.equal(get[0].line, 1); assert.equal(get[0].column, lines[1].indexOf('apikey'));
    const set = idx2.configRefsOf('local_ubattend', 'mode');
    assert.equal(set.length, 1); assert.equal(set[0].column, lines[2].indexOf('mode'));
    assert.equal(idx2.configRefsOf('local_ubattend', 'nest').length, 0, '값에 괄호 → 정규식으로 안전하게 자를 수 없어 침묵');
    assert.equal(idx2.configRefsOf('a', 'b').length, 1, '안쪽 get_config는 그 자체로 사용처');
    assert.equal(idx2.configRefsOf('core', 'core_only').length, 0, '두 인자 set_config(core)는 범위 밖');
    idx2.updateFileText('/c.php', '<?php\n');
    assert.equal(idx2.configRefsOf('local_ubattend', 'apikey').length, 0);
  });
  it('설정 참조: 동적 플러그인·메서드 호출(->get_config)은 침묵', () => {
    const idx2 = new PhpUsageIndex(() => false);
    idx2.updateFileText('/d.php', "<?php\nset_config('k1', $v, $this->pluginname);\n$this->get_config('local_x', 'k2');\n$x = get_config('local_x', 'k3');\n");
    assert.equal(idx2.configRefsOf('core', 'k1').length, 0, '플러그인이 변수면 어디에도 귀속하지 않는다');
    assert.equal(idx2.configRefsOf('local_x', 'k2').length, 0, '메서드 호출은 플러그인 설정 함수가 아니다');
    assert.equal(idx2.configRefsOf('local_x', 'k3').length, 1);
  });
  it('테이블 사용처: SQL의 {table}과 $DB 리터럴 인자, sql_ 계열은 제외', () => {
    const idx2 = new PhpUsageIndex(() => false);
    const src = "<?php\n$x = $DB->get_records_sql('SELECT * FROM {local_x_cfg} c JOIN {user} u ON u.id = c.userid');\n$DB->insert_record('local_x_cfg', $d);\n$DB->sql_like('email', '?');\n$n = $DB->count_records('user');\necho 'id={course}';\n";
    idx2.updateFileText('/t.php', src);
    const lines = src.split('\n');
    const cfg = idx2.tableRefsOf('local_x_cfg');
    assert.equal(cfg.length, 2, 'SQL 1건 + insert_record 1건');
    assert.equal(cfg[0].line, 1);
    assert.equal(cfg[0].column, lines[1].indexOf('local_x_cfg'), '{ 다음이 이름 시작');
    assert.equal(cfg[1].column, lines[2].indexOf('local_x_cfg'));
    assert.equal(idx2.tableRefsOf('user').length, 2, 'SQL 1건 + count_records 1건');
    assert.equal(idx2.tableRefsOf('email').length, 0, 'sql_ 계열의 첫 인자는 컬럼이다');
    assert.equal(idx2.tableRefsOf('course').length, 1, '비SQL 문자열의 {course}도 담는다(조회는 실재 테이블만)');
    idx2.updateFileText('/t.php', '<?php\n');
    assert.equal(idx2.tableRefsOf('local_x_cfg').length, 0, '증분 제거');
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

  it('중첩 경로·코어 서브시스템 참조도 같은 키로 찾는다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/w/a.php',
      `<?php\n$PAGE->requires->js_call_amd('local_manager/code/index', 'init');\n` +
      `$PAGE->requires->js_call_amd('core_form/submit', 'init');\n`);
    assert.equal(idx.amdRefsOf('local_manager', 'code/index').length, 1);
    assert.equal(idx.amdRefsOf('core_form', 'submit').length, 1);
  });

  it('JS 파일에서는 수집하지 않는다(모듈 로딩은 import·require)', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/w/amd/src/a.js', "require(['local_x/mod'], function () {});\n");
    assert.equal(idx.amdRefsOf('local_x', 'mod').length, 0);
  });
});

describe('PhpUsageIndex — mustache 사용처', () => {
  const MUSTACHE = [
    '<div>',
    '  {{> theme_coursemos/header }}',
    '  {{#str}}attendance_book, local_ubattend{{/str}}',
    '</div>',
  ].join('\n');

  it('partial은 템플릿 사용처, {{#str}}는 문자열 사용처로 들어간다', () => {
    const idx = new PhpUsageIndex(() => true);
    const uri = '/w/theme/coursemos/templates/page.mustache';
    idx.updateFileText(uri, MUSTACHE);

    const t = idx.templateRefsOf('theme_coursemos', 'header');
    assert.equal(t.length, 1);
    assert.equal(t[0].line, 1);
    assert.equal(MUSTACHE.split('\n')[1].slice(t[0].column, t[0].column + 'theme_coursemos/header'.length),
      'theme_coursemos/header');

    const s = idx.referencesOf('local_ubattend', 'attendance_book');
    assert.equal(s.length, 1);
    assert.equal(s[0].line, 2);
  });

  it('같은 파일을 다시 넣어도 중복되지 않고, 내용이 사라지면 함께 사라진다', () => {
    const idx = new PhpUsageIndex(() => true);
    const uri = '/w/a.mustache';
    idx.updateFileText(uri, MUSTACHE);
    idx.updateFileText(uri, MUSTACHE);
    assert.equal(idx.templateRefsOf('theme_coursemos', 'header').length, 1);
    idx.updateFileText(uri, '<div></div>');
    assert.equal(idx.templateRefsOf('theme_coursemos', 'header').length, 0);
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_book').length, 0);
  });

  it('문자열 component가 PHP와 같은 규칙으로 정규화된다', () => {
    const core = new PhpUsageIndex(c => c === 'core_grades');
    core.updateFileText('/w/a.mustache', '{{#str}}welcome, grades{{/str}}');
    assert.equal(core.referencesOf('core_grades', 'welcome').length, 1,
      '정규화를 거치지 않으면 lang 쪽 참조 목록에서 갈린다');

    const legacy = new PhpUsageIndex(() => false);
    legacy.updateFileText('/w/b.mustache', '{{#str}}welcome, forum{{/str}}');
    assert.equal(legacy.referencesOf('mod_forum', 'welcome').length, 1, '레거시 mod 단축도 같다');
  });

  it('.mustache가 색인 대상 경로다', () => {
    assert.equal(isIndexableSourcePath('/w', '/w/theme/x/templates/a.mustache'), true);
  });
});

describe('PhpUsageIndex — 순회(심볼릭 링크·순환)', () => {
  let tmp: string;
  before(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-walk-'));
    fs.mkdirSync(join(tmp, 'root', 'local', 'real'), { recursive: true });
    fs.mkdirSync(join(tmp, 'target'), { recursive: true });
    fs.writeFileSync(join(tmp, 'root', 'local', 'real', 'a.php'), "<?php\nget_string('k1', 'local_x');\n");
    fs.writeFileSync(join(tmp, 'target', 'b.php'), "<?php\nget_string('k2', 'local_x');\n");
    fs.symlinkSync(join(tmp, 'target'), join(tmp, 'root', 'local', 'linked'), 'dir');
    fs.symlinkSync(join(tmp, 'root'), join(tmp, 'root', 'local', 'loop'), 'dir');
    fs.symlinkSync(join(tmp, 'nowhere'), join(tmp, 'root', 'local', 'broken'), 'dir');
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('링크된 디렉터리는 색인하고, 순환·깨진 링크에서 멈추지 않는다', async () => {
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(join(tmp, 'root'));
    assert.equal(idx.referencesOf('local_x', 'k1').length, 1, '실디렉터리');
    assert.equal(idx.referencesOf('local_x', 'k2').length, 1, '링크된 디렉터리');
  });
});

describe('PhpUsageIndex — 파일 스탬프', () => {
  it('빌드는 스탬프를 기록하고, 스탬프 없는 갱신은 그 파일 스탬프를 지운다', async () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-stamp-'));
    try {
      const f = join(tmp, 'x.php');
      fs.writeFileSync(f, "<?php\nget_string('k', 'local_x');\n");
      const idx = new PhpUsageIndex(() => true);
      await idx.buildFromRoot(tmp);
      // stamps는 파일 경로가 아니라 풀 id로 담긴다 — find로 id를 먼저 얻는다.
      const internal = idx as unknown as { stamps: Map<number, { size: number }>; pool: { find(v: string): number | undefined } };
      const fid = internal.pool.find(f)!;
      assert.equal(internal.stamps.size, 1);
      assert.ok(internal.stamps.get(fid)!.size > 0);
      idx.updateFileText(f, "<?php\n");
      assert.equal(internal.stamps.has(fid), false, '다음 검증에서 다시 읽도록 표시');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe('PhpUsageIndex — 스냅샷 왕복', () => {
  it('빌드한 색인을 스냅샷으로 저장하고 되돌리면 네 조회가 모두 같다', async () => {
    const src = new PhpUsageIndex(hasCanonical);
    await src.buildFromRoot(root);
    const snap = src.toSnapshot(root, '9.9.9');
    assert.equal(snap.ext, '9.9.9');
    assert.equal(snap.root, root);
    assert.ok(snap.files.length >= 1);

    // hasCanonical을 안 써도 같아야 한다 — canonical 이름이 스냅샷에 들어 있다
    const loaded = new PhpUsageIndex(() => false);
    assert.equal(loaded.isBuilt, false);
    loaded.loadSnapshot(snap, root);
    assert.equal(loaded.isBuilt, true);
    for (const [c, k] of [['local_ubattend', 'attendance_book'], ['mod_testmod', 'pluginname'], ['core', 'ok']] as const) {
      assert.deepEqual(loaded.referencesOf(c, k), src.referencesOf(c, k), `${c}/${k}`);
    }
    assert.deepEqual(loaded.templateRefsOf('local_ubattend', 'setting'), src.templateRefsOf('local_ubattend', 'setting'));
    assert.deepEqual(loaded.amdRefsOf('local_ubattend', 'setting'), src.amdRefsOf('local_ubattend', 'setting'));
    assert.deepEqual(loaded.configRefsOf('local_ubattend', 'attendlimit'), src.configRefsOf('local_ubattend', 'attendlimit'));
  });
  it('되돌린 색인도 증분 갱신이 된다(파일별 역인덱스가 복원됨)', async () => {
    const src = new PhpUsageIndex(hasCanonical);
    await src.buildFromRoot(root);
    const loaded = new PhpUsageIndex(() => false);
    loaded.loadSnapshot(src.toSnapshot(root, '1'), root);
    const uri = join(root, 'local/ubattend/view.php');
    assert.ok(loaded.referencesOf('local_ubattend', 'attendance_book').some(r => r.uri === uri));
    loaded.updateFileText(uri, '<?php\n');
    assert.equal(loaded.referencesOf('local_ubattend', 'attendance_book').filter(r => r.uri === uri).length, 0);
  });
});

describe('PhpUsageIndex — 백그라운드 검증', () => {
  let tmp: string;
  const write = (name: string, body: string) => fs.writeFileSync(join(tmp, name), body);
  beforeEach(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-reval-'));
    write('a.php', "<?php\nget_string('k1', 'local_x');\n");
    write('b.php', "<?php\nget_string('k2', 'local_x');\n");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('바뀐 것이 없으면 false', async () => {
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(tmp);
    assert.equal(await idx.revalidateFromRoot(tmp), false);
  });
  it('수정·추가·삭제를 반영한다', async () => {
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(tmp);
    write('a.php', "<?php\nget_string('k1b', 'local_x');\n");
    write('c.php', "<?php\nget_string('k3', 'local_x');\n");
    fs.unlinkSync(join(tmp, 'b.php'));
    assert.equal(await idx.revalidateFromRoot(tmp), true);
    assert.equal(idx.referencesOf('local_x', 'k1').length, 0, '옛 키는 사라진다');
    assert.equal(idx.referencesOf('local_x', 'k1b').length, 1, '수정 반영');
    assert.equal(idx.referencesOf('local_x', 'k3').length, 1, '새 파일 반영');
    assert.equal(idx.referencesOf('local_x', 'k2').length, 0, '삭제된 파일의 항목은 사라진다');
  });
  it('도장 없이 갱신된 파일은 다시 읽어 디스크 내용으로 복구한다', async () => {
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(tmp);
    idx.updateFileText(join(tmp, 'a.php'), '<?php\n');
    assert.equal(idx.referencesOf('local_x', 'k1').length, 0);
    assert.equal(await idx.revalidateFromRoot(tmp), true);
    assert.equal(idx.referencesOf('local_x', 'k1').length, 1);
  });
});

describe('PhpUsageIndex — 순회 중복 방지(심볼릭 링크)', () => {
  let tmp: string;
  const build = async (r: string) => { const i = new PhpUsageIndex(() => true); await i.buildFromRoot(r); return i; };
  beforeEach(() => { tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-dedupe-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('링크가 조상을 가리켜도 같은 파일을 두 번 담지 않는다', async () => {
    fs.mkdirSync(join(tmp, 'root', 'local', 'real'), { recursive: true });
    fs.writeFileSync(join(tmp, 'root', 'local', 'real', 'a.php'), "<?php\nget_string('k1', 'local_x');\n");
    fs.symlinkSync(join(tmp, 'root', 'local'), join(tmp, 'root', 'local', 'up'), 'dir');
    const idx = await build(join(tmp, 'root'));
    assert.equal(idx.referencesOf('local_x', 'k1').length, 1);
  });
  it('루트 안 실디렉터리를 가리키는 링크도 한 번만 담는다', async () => {
    fs.mkdirSync(join(tmp, 'root', 'plugins', 'foo'), { recursive: true });
    fs.mkdirSync(join(tmp, 'root', 'local'), { recursive: true });
    fs.writeFileSync(join(tmp, 'root', 'plugins', 'foo', 'a.php'), "<?php\nget_string('k2', 'local_x');\n");
    fs.symlinkSync(join(tmp, 'root', 'plugins', 'foo'), join(tmp, 'root', 'local', 'foo'), 'dir');
    const idx = await build(join(tmp, 'root'));
    assert.equal(idx.referencesOf('local_x', 'k2').length, 1);
  });
});

describe('PhpUsageIndex — 검증 온전성', () => {
  it('순회가 실패하면(루트 소실) 색인을 비우지 않고 false', async () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-gone-'));
    const idx = new PhpUsageIndex(() => true);
    try {
      fs.writeFileSync(join(tmp, 'a.php'), "<?php\nget_string('k', 'local_x');\n");
      await idx.buildFromRoot(tmp);
      assert.equal(idx.referencesOf('local_x', 'k').length, 1);
      fs.rmSync(tmp, { recursive: true, force: true });
      assert.equal(await idx.revalidateFromRoot(tmp), false, '사라진 것으로 단정하지 않는다');
      assert.equal(idx.referencesOf('local_x', 'k').length, 1, '항목이 남아 있어야 한다');
      assert.ok(idx.toSnapshot(tmp, '1').files.length >= 1, '빈 스냅샷을 굽지 않는다');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe('PhpUsageIndex — 복원 순서·재복원', () => {
  it('문자열 항목이 없는 파일이 섞여도 복원 순서가 스캔과 같다', async () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-order-'));
    try {
      // a.mustache는 템플릿 참조만, b.php는 문자열 + 템플릿 참조 — 정렬 순서상 a가 먼저다
      fs.writeFileSync(join(tmp, 'a.mustache'), '{{> local_x/card}}\n');
      fs.writeFileSync(join(tmp, 'b.php'), "<?php\nget_string('k', 'local_x');\n$OUTPUT->render_from_template('local_x/card', []);\n");
      const scanned = new PhpUsageIndex(() => true);
      await scanned.buildFromRoot(tmp);
      const restored = new PhpUsageIndex(() => true);
      restored.loadSnapshot(scanned.toSnapshot(tmp, '1'), tmp);
      assert.deepEqual(restored.templateRefsOf('local_x', 'card').map(r => r.uri),
        scanned.templateRefsOf('local_x', 'card').map(r => r.uri));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
  it('두 번 복원해도 항목이 겹치지 않는다', async () => {
    const src = new PhpUsageIndex(hasCanonical);
    await src.buildFromRoot(root);
    const snap = src.toSnapshot(root, '1');
    const idx = new PhpUsageIndex(() => true);
    idx.loadSnapshot(snap, root);
    const once = idx.referencesOf('local_ubattend', 'attendance_book').length;
    idx.loadSnapshot(snap, root);
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_book').length, once);
  });
  it('범위 밖 파일 인덱스는 uri 없는 항목을 만들지 않는다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.loadSnapshot({ v: 2, ext: '1', root: '/m', files: [['a.php', 1, 2]],
      s: [7, 1, 'local_x', 'k', 0, 0], t: [], a: [], c: [], x: [] }, '/m');
    assert.deepEqual(idx.referencesOf('local_x', 'k'), []);
  });
});

describe('PhpUsageIndex — 테이블 사용처 스냅샷', () => {
  it('스냅샷 왕복에 테이블 사용처가 포함된다', async () => {
    const src = new PhpUsageIndex(() => true);
    src.updateFileText('/s.php', "<?php\n$DB->delete_records('local_ubattend_config', []);\n");
    const snap = src.toSnapshot('/', '1');
    const loaded = new PhpUsageIndex(() => true);
    loaded.loadSnapshot(snap, '/');
    assert.deepEqual(loaded.tableRefsOf('local_ubattend_config'), src.tableRefsOf('local_ubattend_config'));
  });
});

describe('PhpUsageIndex — 풀 규율', () => {
  it('없는 값으로 조회해도 풀이 자라지 않는다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/a/b.php', `<?php echo get_string('k', 'local_x');`);
    const before = (idx as unknown as { pool: { size: number } }).pool.size;
    idx.referencesOf('없는컴포넌트', '없는키');
    idx.templateRefsOf('없는컴포넌트', '없는이름');
    idx.amdRefsOf('없는컴포넌트', '없는이름');
    idx.configRefsOf('없는플러그인', '없는키');
    idx.tableRefsOf('없는테이블');
    assert.equal((idx as unknown as { pool: { size: number } }).pool.size, before);
  });

  it('파일을 다시 읽으면 옛 항목이 게시 목록에서 빠진다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/a/b.php', `<?php echo get_string('old', 'local_x');`);
    idx.updateFileText('/a/b.php', `<?php echo get_string('new', 'local_x');`);
    assert.equal(idx.referencesOf('local_x', 'old').length, 0);
    assert.equal(idx.referencesOf('local_x', 'new').length, 1);
  });

  it('두 파일이 같은 키를 쓰면 한 파일만 지워도 다른 파일은 남는다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/a/one.php', `<?php echo get_string('k', 'local_x');`);
    idx.updateFileText('/a/two.php', `<?php echo get_string('k', 'local_x');`);
    idx.updateFileText('/a/one.php', '');
    const found = idx.referencesOf('local_x', 'k');
    assert.equal(found.length, 1);
    assert.equal(found[0].uri, '/a/two.php');
  });
});
