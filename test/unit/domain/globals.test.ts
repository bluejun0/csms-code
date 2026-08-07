import { strict as assert } from 'assert';
import { MOODLE_GLOBALS } from '../../../src/domain/moodle-model/globals';

describe('MOODLE_GLOBALS', () => {
  it('클래스·테이블·설정 세 종류를 모두 담는다', () => {
    assert.deepEqual(MOODLE_GLOBALS.DB, { kind: 'class', className: 'moodle_database' });
    assert.deepEqual(MOODLE_GLOBALS.PAGE, { kind: 'class', className: 'moodle_page' });
    assert.deepEqual(MOODLE_GLOBALS.OUTPUT, { kind: 'class', className: 'core_renderer' });
    assert.deepEqual(MOODLE_GLOBALS.USER, { kind: 'table', tableName: 'user' });
    assert.deepEqual(MOODLE_GLOBALS.SITE, { kind: 'table', tableName: 'course' });
    assert.deepEqual(MOODLE_GLOBALS.COURSE, { kind: 'table', tableName: 'course' });
    assert.deepEqual(MOODLE_GLOBALS.CFG, { kind: 'config' });
  });

  it('전역이 아닌 이름은 없다', () => {
    assert.equal(MOODLE_GLOBALS['rec'], undefined);
    assert.equal(MOODLE_GLOBALS['db'], undefined);
  });
});
