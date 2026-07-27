import { strict as assert } from 'assert';
import { parseFrankenstyle, levenshtein } from '../../../src/domain/shared/value-objects';

describe('parseFrankenstyle', () => {
  it('local_ubattend → {local, ubattend}', () => {
    assert.deepEqual(parseFrankenstyle('local_ubattend'), { type: 'local', name: 'ubattend' });
  });
  it('mod_assign → {mod, assign}', () => {
    assert.deepEqual(parseFrankenstyle('mod_assign'), { type: 'mod', name: 'assign' });
  });
  it('core → {core, core}', () => {
    assert.deepEqual(parseFrankenstyle('core'), { type: 'core', name: 'core' });
  });
});
describe('levenshtein', () => {
  it('coursid vs courseid = 1', () => assert.equal(levenshtein('coursid', 'courseid'), 1));
  it('equal = 0', () => assert.equal(levenshtein('abc', 'abc'), 0));
});
