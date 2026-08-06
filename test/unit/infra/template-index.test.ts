import { strict as assert } from 'assert';
import { join } from 'path';
import { TemplateIndex } from '../../../src/infrastructure/templates/template-index';
import { componentOfTemplateFile } from '../../../src/infrastructure/workspace/moodle-root-resolver';

const root = join(__dirname, '../../fixtures/mini-moodle');
const idx = new TemplateIndex();
idx.buildFromRoot(root); // 동기 — 모듈 로드 시 1회

describe('TemplateIndex', () => {
  it('코어: lib/templates → core', () => {
    assert.equal(idx.locationsOf('core', 'core_tmpl').length, 1);
    assert.ok(idx.locationsOf('core', 'core_tmpl')[0].uri.endsWith(join('lib', 'templates', 'core_tmpl.mustache')));
  });
  it('플러그인 + 하위 경로 이름', () => {
    assert.equal(idx.has('local_ubattend', 'svg/icon/hyflex'), true);
    assert.ok(idx.locationsOf('local_ubattend', 'svg/icon/hyflex')[0].uri.endsWith(join('svg', 'icon', 'hyflex.mustache')));
  });
  it('테마 오버라이드: 원본 + 오버라이드 둘 다 반환', () => {
    const locs = idx.locationsOf('local_ubattend', 'setting');
    assert.equal(locs.length, 2);
    assert.ok(locs.some(l => l.uri.includes(join('local', 'ubattend', 'templates'))));
    assert.ok(locs.some(l => l.uri.includes(join('theme', 'coursemos', 'templates'))));
  });
  it('테마 자체 템플릿은 theme_<name> 컴포넌트', () =>
    assert.equal(idx.has('theme_coursemos', 'own'), true));
  it('규칙 밖(코어 서브시스템 grade/templates)은 무시', () => {
    assert.equal(idx.has('core_grades', 'ignored'), false);
    assert.equal(idx.has('grade', 'ignored'), false);
  });
  it('없는 템플릿은 빈 배열', () => assert.deepEqual(idx.locationsOf('local_ubattend', 'nope'), []));
});

describe('componentOfTemplateFile (경로 역산)', () => {
  it('플러그인 하위 경로', () =>
    assert.deepEqual(componentOfTemplateFile(root, join(root, 'local/ubattend/templates/svg/icon/hyflex.mustache')),
      { component: 'local_ubattend', name: 'svg/icon/hyflex' }));
  it('코어', () =>
    assert.deepEqual(componentOfTemplateFile(root, join(root, 'lib/templates/core_tmpl.mustache')),
      { component: 'core', name: 'core_tmpl' }));
  it('테마 오버라이드는 덮는 대상 컴포넌트로', () =>
    assert.deepEqual(componentOfTemplateFile(root, join(root, 'theme/coursemos/templates/local_ubattend/setting.mustache')),
      { component: 'local_ubattend', name: 'setting' }));
  it('테마 자체 템플릿', () =>
    assert.deepEqual(componentOfTemplateFile(root, join(root, 'theme/coursemos/templates/own.mustache')),
      { component: 'theme_coursemos', name: 'own' }));
  it('규칙 밖 → null', () =>
    assert.equal(componentOfTemplateFile(root, join(root, 'grade/templates/ignored.mustache')), null));
  it('루트 밖 → null', () =>
    assert.equal(componentOfTemplateFile(root, '/etc/x.mustache'), null));
});

describe('TemplateIndex — 비동기 빌드·증분', () => {
  const override = join(root, 'theme/coursemos/templates/local_ubattend/setting.mustache');

  it('async 빌드가 sync와 동일 결과', async () => {
    const a = new TemplateIndex(); a.buildFromRoot(root);
    const b = new TemplateIndex(); await b.buildFromRootAsync(root);
    const dump = (s: TemplateIndex) => s.locationsOf('local_ubattend', 'setting').map(l => l.uri).sort();
    assert.deepEqual(dump(b), dump(a));
    assert.equal(b.has('core', 'core_tmpl'), a.has('core', 'core_tmpl'));
  });
  it('진행률 콜백이 최소 1회 호출되고 done ≤ total', async () => {
    const s = new TemplateIndex();
    const calls: [number, number][] = [];
    await s.buildFromRootAsync(root, (d, t) => calls.push([d, t]));
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(([d, t]) => d <= t));
  });
  it('removeFile: 오버라이드만 제거하면 원본이 남는다', async () => {
    const s = new TemplateIndex(); await s.buildFromRootAsync(root);
    assert.equal(s.locationsOf('local_ubattend', 'setting').length, 2, '사전 조건');
    s.removeFile(override);
    const left = s.locationsOf('local_ubattend', 'setting');
    assert.equal(left.length, 1);
    assert.ok(left[0].uri.includes(join('local', 'ubattend', 'templates')));
  });
  it('removeFile: 마지막 위치가 사라지면 키도 사라진다', async () => {
    const s = new TemplateIndex(); await s.buildFromRootAsync(root);
    s.removeFile(join(root, 'lib/templates/core_tmpl.mustache'));
    assert.equal(s.has('core', 'core_tmpl'), false);
  });
  it('증분(update)이 전체 재빌드와 순서까지 동일하게 수렴', async () => {
    const originalFile = join(root, 'local/ubattend/templates/setting.mustache');
    const s = new TemplateIndex(); await s.buildFromRootAsync(root);
    // 원본(자연 순서상 앞자리)을 갱신해도 순서가 뒤집히지 않아야 한다 — F12·hover 표시 순서에 그대로 노출된다
    s.updateFile(originalFile, 'local_ubattend', 'setting');
    const full = new TemplateIndex(); await full.buildFromRootAsync(root);
    assert.deepEqual(
      s.locationsOf('local_ubattend', 'setting').map(l => l.uri),
      full.locationsOf('local_ubattend', 'setting').map(l => l.uri),
      'sort 없이 raw 순서까지 같아야 함');
  });
  it('다른 키로 이동한 템플릿은 옛 키에서 제거된다', async () => {
    const originalFile = join(root, 'local/ubattend/templates/setting.mustache');
    const s = new TemplateIndex(); await s.buildFromRootAsync(root);
    s.updateFile(originalFile, 'local_ubattend', 'renamed');
    assert.ok(!s.locationsOf('local_ubattend', 'setting').some(l => l.uri === originalFile), '옛 키에서 제거');
    assert.ok(s.locationsOf('local_ubattend', 'renamed').some(l => l.uri === originalFile), '새 키에 등록');
  });
});
