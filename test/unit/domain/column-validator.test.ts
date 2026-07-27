import { strict as assert } from 'assert';
import { Table } from '../../../src/domain/moodle-model/table';
import { closestColumn } from '../../../src/domain/moodle-model/services/column-validator';

const loc = { uri: 'x', line: 0, column: 0 };
const t = new Table('t', 'c', ['id', 'courseid', 'userid'].map(n =>
  ({ name: n, type: 'int', comment: '', notnull: true, default: null, location: loc })), loc);

describe('closestColumn', () => {
  it('오타 coursid → courseid', () => assert.equal(closestColumn(t, 'coursid'), 'courseid'));
  it('거리 초과면 undefined', () => assert.equal(closestColumn(t, 'zzzzzzzz'), undefined));
});
