import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';
import { CompleteStringKeys } from '../../../src/application/complete-string-keys';
import { ResolveStringDefinition } from '../../../src/application/resolve-string-definition';
import { DescribeString } from '../../../src/application/describe-string';
import { ValidateStringKeys } from '../../../src/application/validate-string-keys';
import { ListResolvedStringCalls } from '../../../src/application/list-resolved-string-calls';
import { FindStringReferences } from '../../../src/application/find-string-references';

const root = join(__dirname, '../../fixtures/mini-moodle');
const store = new StringIndexStore();
store.buildFromRoot(root); // 동기 — 모듈 로드 시 1회

const CODE = `<?php
function s() {
  echo get_string('attendance_book', 'local_ubattend');
  echo get_string('attendance_bok', 'local_ubattend');
  echo get_string('anything', 'local_unknown');
}
`;

describe('언어 문자열 유즈케이스 (E2E)', () => {
  it('완성: 키 + ko/en 값', () => {
    const items = new CompleteStringKeys(store).run('local_ubattend');
    const book = items.find(i => i.key === 'attendance_book')!;
    assert.equal(book.ko, '출석부');
    assert.equal(book.en, 'Attendance book');
    assert.equal(items.length, 2);
  });
  it('정의로 이동: ko·en 두 위치(커서가 key 안)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf('attendance_book') + 3;
    const locs = new ResolveStringDefinition(syn, store).run(CODE, at);
    assert.equal(locs.length, 2);
    assert.ok(locs.some(l => l.location.uri.endsWith('lang/ko/local_ubattend.php')));
    assert.ok(locs.some(l => l.location.uri.endsWith('lang/en/local_ubattend.php')));
  });
  it('hover: 한국어 값 + 영어 값', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf('attendance_book') + 3;
    const r = new DescribeString(syn, store).run(CODE, at)!;
    assert.match(r.markdown, /출석부/);
    assert.match(r.markdown, /Attendance book/);
  });
  it('진단: 누락 키만 경고 + 가장 가까운 키 제안, 미색인 컴포넌트는 침묵', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const diags = new ValidateStringKeys(syn, store).run(CODE);
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /attendance_bok/);
    assert.equal(diags[0].suggestion, 'attendance_book');
    assert.equal(diags[0].kind, 'string', '문자열 진단은 string 종류여야 한다');
    assert.equal(diags[0].length, 'attendance_bok'.length);
  });
  it('hover/정의: 커서가 key 밖(component 위)이면 null/[]', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf("'local_ubattend'") + 3;
    assert.equal(new DescribeString(syn, store).run(CODE, at), null);
    assert.deepEqual(new ResolveStringDefinition(syn, store).run(CODE, at), []);
  });
});

describe('참조·하이라이트 유즈케이스', () => {
  it('ListResolvedStringCalls: 해석되는 키 범위만 (누락 키·미색인 component 제외)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const r = new ListResolvedStringCalls(syn, store).run(CODE);
    assert.deepEqual(r, [{ line: 2, column0: CODE.split('\n')[2].indexOf('attendance_book'), length: 'attendance_book'.length }]);
  });
  it('FindStringReferences: 포트 위임', () => {
    const fake = { referencesOf: (c: string, k: string) => [{ uri: `${c}/${k}`, line: 0, column: 0 }] };
    assert.equal(new FindStringReferences(fake).run('local_ubattend', 'x')[0].uri, 'local_ubattend/x');
  });
});
