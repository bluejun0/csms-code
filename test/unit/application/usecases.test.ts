import { strict as assert } from 'assert';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { InMemoryTableRepository } from '../../../src/infrastructure/xmldb/xmldb-table-repository';
import { Table } from '../../../src/domain/moodle-model/table';
import { RecordTypeInference } from '../../../src/domain/code-analysis/record-type-inference';
import { ValidateRecordColumns } from '../../../src/application/validate-record-columns';

const loc = { uri: 'x', line: 0, column: 0 };
const mk = (name: string, cols: string[]) => new Table(name, 'c', cols.map(n => ({ name: n, type: 'int', comment: n === 'courseid' ? '강좌번호' : '', notnull: true, default: null, location: loc })), loc);
const repo = new InMemoryTableRepository([mk('local_ubattend_config', ['id', 'courseid', 'smart_status'])]);

const CODE = `<?php
function f() {
  $c = $DB->get_record('local_ubattend_config', ['id' => 1]);
  echo $c->courseid;   // 정상
  echo $c->coursid;    // 오타 → courseid 제안
}
`;

describe('ValidateRecordColumns', () => {
  it('오타 컬럼만 진단 + 제안', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const uc = new ValidateRecordColumns(syn, repo, new RecordTypeInference());
    const diags = uc.run(CODE);
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /coursid/);
    assert.equal(diags[0].suggestion, 'courseid');
  });
});
