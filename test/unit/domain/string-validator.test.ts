import { strict as assert } from 'assert';
import { closestKey } from '../../../src/domain/lang-model/services/string-validator';

describe('closestKey', () => {
  it('편집거리 최소 키 제안', () =>
    assert.equal(closestKey(['attendance_book', 'attendance_rate'], 'attendance_bok'), 'attendance_book'));
  it('거리 초과 시 undefined', () =>
    assert.equal(closestKey(['attendance_book'], 'zzzz'), undefined));
});
