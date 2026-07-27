import { strict as assert } from 'assert';
import { Table, Field } from '../../../src/domain/moodle-model/table';

const loc = { uri: 'x', line: 0, column: 0 };
const f = (name: string): Field => ({ name, type: 'int', comment: '', notnull: true, default: null, location: loc });

describe('Table', () => {
  const t = new Table('local_ubattend_config', 'local_ubattend', [f('id'), f('courseid')], loc);
  it('hasField', () => { assert.equal(t.hasField('courseid'), true); assert.equal(t.hasField('nope'), false); });
  it('findField returns field', () => assert.equal(t.findField('id')?.name, 'id'));
  it('fieldNames', () => assert.deepEqual(t.fieldNames(), ['id', 'courseid']));
});
