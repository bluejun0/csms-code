import { strict as assert } from 'assert';
import { langLensTargets, settingsLensTargets, templateLensTargets } from '../../../src/presentation/lens-targets';
import { SHOW_CONFIG_REFERENCES_COMMAND, SHOW_STRING_REFERENCES_COMMAND, SHOW_TEMPLATE_REFERENCES_COMMAND } from '../../../src/presentation/references-link';

const counter = { built: () => true, count: (c: string, k: string) => `${c}/${k}`.length };

describe('lens targets — 렌즈 대상 조립', () => {
  it('lang: 항목마다 문자열 명령·개수', () => {
    const [t] = langLensTargets('file:///l.php', [{ key: 'k', line: 3 }], 'local_x', counter);
    assert.equal(t.line, 3);
    assert.equal(t.command, SHOW_STRING_REFERENCES_COMMAND);
    assert.deepEqual(t.args, { uri: 'file:///l.php', line: 3, character: 0, component: 'local_x', key: 'k' });
    assert.equal(t.count(), 'local_x/k'.length);
  });
  it('mustache: 파일 전체가 한 템플릿 — 맨 위에 템플릿 명령 버튼 하나', () => {
    const targets = templateLensTargets('file:///t.mustache', { component: 'local_x', name: 'svg/icon' }, counter);
    assert.equal(targets.length, 1);
    const [t] = targets;
    assert.equal(t.line, 0);
    assert.equal(t.command, SHOW_TEMPLATE_REFERENCES_COMMAND);
    assert.deepEqual(t.args, { uri: 'file:///t.mustache', line: 0, character: 0, component: 'local_x', key: 'svg/icon' });
    assert.equal(t.count(), 'local_x/svg/icon'.length);
  });
  it('settings: 선언마다 설정 명령, 컬럼은 첫 인자, 색인 전이면 count null', () => {
    const [t] = settingsLensTargets('file:///s.php',
      [{ plugin: 'local_x', key: 'k', location: { line: 5, column: 20 } }], { built: () => false, count: () => 0 });
    assert.equal(t.command, SHOW_CONFIG_REFERENCES_COMMAND);
    assert.deepEqual(t.args, { uri: 'file:///s.php', line: 5, character: 20, component: 'local_x', key: 'k' });
    assert.equal(t.count(), null);
  });
});
