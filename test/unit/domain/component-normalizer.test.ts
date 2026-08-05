import { strict as assert } from 'assert';
import { normalizeComponent } from '../../../src/domain/lang-model/services/component-normalizer';

const has = (c: string) => c === 'core_grades';

describe('normalizeComponent', () => {
  it("''/'moodle'/'core' → core", () => {
    for (const raw of ['', 'moodle', 'core', ' core ']) assert.equal(normalizeComponent(raw, has), 'core');
  });
  it('_ 포함은 그대로 (core_grades/mod_assign/local_ubattend)', () => {
    for (const raw of ['core_grades', 'mod_assign', 'local_ubattend']) assert.equal(normalizeComponent(raw, has), raw);
  });
  it('bare 이름: core_<s>가 존재하면 코어 서브시스템', () =>
    assert.equal(normalizeComponent('grades', has), 'core_grades'));
  it('bare 이름: 아니면 레거시 mod 단축', () =>
    assert.equal(normalizeComponent('assign', has), 'mod_assign'));
});
