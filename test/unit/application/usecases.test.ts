import { strict as assert } from 'assert';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { InMemoryTableRepository } from '../../../src/infrastructure/xmldb/xmldb-table-repository';
import { Table } from '../../../src/domain/moodle-model/table';
import { RecordTypeInference } from '../../../src/domain/code-analysis/record-type-inference';
import { ValidateRecordColumns } from '../../../src/application/validate-record-columns';
import { CompleteRecordColumns } from '../../../src/application/complete-record-columns';

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
    assert.equal(diags[0].kind, 'column', '컬럼 진단은 column 종류여야 한다');
  });
});

// scopeContaining 클로저 정밀화: 일반 대입만 있는 클로저가
// 스코프 축소에 보여야 바깥 바인딩이 클로저 안 완성으로 새지 않는다.
const CODE2 = `<?php
function g() {
  $c = $DB->get_record('local_ubattend_config', ['id' => 1]);
  echo $c->courseid;
  echo get_string('attendance_book', 'local_ubattend');
  $fn = function () {
    $tmp = 1;
  };
}
`;

describe('CompleteRecordColumns — scopeContaining 클로저 정밀화', () => {
  it('일반 대입만 있는 클로저 내부 → 바깥 바인딩이 새지 않음([])', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const uc = new CompleteRecordColumns(syn, repo, new RecordTypeInference());
    const atInsideClosure = CODE2.indexOf('$tmp');
    assert.deepEqual(uc.run(CODE2, 'c', atInsideClosure), []);
  });
  it('양성 대조: 바깥 함수 위치에서는 컬럼 3개(정상 완성 무회귀)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const uc = new CompleteRecordColumns(syn, repo, new RecordTypeInference());
    const atOuter = CODE2.indexOf('$c->courseid');
    assert.equal(uc.run(CODE2, 'c', atOuter).length, 3);
  });
});

// 컬렉션 분리 E2E 음성 핀: 도메인 테스트는 합성 팩트라 tree-sitter 추출이
// 표류하면 못 잡는다. 컬렉션 분리(965295a) 이전 코드라면 'foo' 진단 1건이 나와 실패했을 핀.
const CODE3 = `<?php
function h() {
  $rs = $DB->get_recordset('local_ubattend_config', ['id' => 1]);
  echo $rs->foo;
}
`;

describe('ValidateRecordColumns — 컬렉션 변수 음성 핀', () => {
  it('recordset 변수 프로퍼티 접근 → 진단 0건 (실파서 E2E)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const uc = new ValidateRecordColumns(syn, repo, new RecordTypeInference());
    assert.equal(uc.run(CODE3).length, 0);
  });
});
