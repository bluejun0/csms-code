import { strict as assert } from 'assert';
import { completionLabelParts, hoverMarkdownWithSource, SOURCE_LABEL }
  from '../../../src/presentation/source-label-text';

describe('출처 표시', () => {
  it('켜면 완성 라벨에 출처가 붙고 라벨 자체는 그대로다', () => {
    const p = completionLabelParts('courseid', 'int', true);
    assert.equal(p.label, 'courseid', '필터링에 쓰이는 라벨은 변형하지 않는다');
    assert.equal(p.description, SOURCE_LABEL);
    assert.equal(p.detail, ' int');
  });

  it('끄면 출처가 없다', () => {
    const p = completionLabelParts('courseid', 'int', false);
    assert.equal(p.description, undefined);
    assert.equal(p.label, 'courseid');
  });

  it('detail이 없으면 detail도 없다', () => {
    assert.equal(completionLabelParts('x', undefined, true).detail, undefined);
    assert.equal(completionLabelParts('x', '', true).detail, undefined);
  });

  it('hover는 본문 아래에 출처 한 줄을 덧붙인다', () => {
    const md = hoverMarkdownWithSource('**user.id**', true);
    assert.ok(md.startsWith('**user.id**'), '본문이 앞에 온다');
    assert.ok(md.trimEnd().endsWith(`\`${SOURCE_LABEL}\``));
    assert.equal(hoverMarkdownWithSource('**user.id**', false), '**user.id**');
  });
});
