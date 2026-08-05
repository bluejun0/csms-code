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
