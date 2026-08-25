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
  it('hover 결과에 canonical 대상이 실린다 — 사용처 링크가 이 좌표로 색인을 조회한다', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const r = new DescribeString(syn, store).run(CODE, CODE.indexOf('attendance_book') + 3)!;
    assert.deepEqual(r.target, { component: 'local_ubattend', key: 'attendance_book' });
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
  it('진단: print_string의 누락 키도 경고한다', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const diags = new ValidateStringKeys(syn, store).run("<?php\nprint_string('attendance_bok', 'local_ubattend');\n");
    assert.equal(diags.length, 1);
    assert.equal(diags[0].suggestion, 'attendance_book');
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
    assert.equal(new FindStringReferences(fake, store).run('local_ubattend', 'x')[0].uri, 'local_ubattend/x');
  });
});

// 컴포넌트가 리터럴이 아닌 호출도 같은 파일의 리터럴로 해석되면 네 기능이 동작한다.
const DYN = `<?php
class Provider {
    protected $pluginname = 'local_ubattend';
    public function label() {
        $comp = 'local_ubattend';
        $a = get_string('attendance_book', $comp);
        $b = get_string('attendance_book', $this->pluginname);
        $c = get_string('no_such_key', $comp);
        $d = get_string('attendance_book', $unknown);
        $e = get_string('attendance_book', $ambiguous);
        $ambiguous = 'local_ubattend';
        $ambiguous = 'block_testblock';
        return [$a, $b, $c, $d, $e];
    }
}
`;

describe('언어 문자열 — 동적 컴포넌트 전파 (E2E)', () => {
  let syn: TreeSitterPhpSyntax;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); });
  const at = (needle: string, nth = 0) => {
    let i = -1;
    for (let n = 0; n <= nth; n++) i = DYN.indexOf(needle, i + 1);
    return i + 2;
  };

  it('정의 이동: 변수·프로퍼티에서 해석된다', () => {
    const uc = new ResolveStringDefinition(syn, store);
    assert.ok(uc.run(DYN, at('attendance_book', 0)).length > 0, '변수');
    assert.ok(uc.run(DYN, at('attendance_book', 1)).length > 0, '$this 프로퍼티');
  });

  it('hover: 해석된 컴포넌트의 값을 보여준다', () => {
    const h = new DescribeString(syn, store).run(DYN, at('attendance_book', 0));
    assert.ok(h && /출석부/.test(h.markdown), h?.markdown);
  });

  it('하이라이트: 해석되는 키만', () => {
    const r = new ListResolvedStringCalls(syn, store).run(DYN);
    assert.equal(r.length, 2, '변수·프로퍼티 두 건만(없는 키·미해석은 제외)');
  });

  it('진단: 해석된 컴포넌트의 누락 키만 경고한다', () => {
    const diags = new ValidateStringKeys(syn, store).run(DYN);
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /no_such_key/);
  });

  it('진단: 정의 없는 변수·모호한 변수에는 경고가 없다', () => {
    const diags = new ValidateStringKeys(syn, store).run(DYN);
    assert.ok(!diags.some(d => /attendance_book/.test(d.message)), '해석되지 않은 호출은 검사 대상이 아니다');
  });

  it('리터럴이 아닌 대입에서 온 컴포넌트에는 진단이 없다', () => {
    const code = `<?php\nfunction f() { $c = get_component(); echo get_string('no_such_key', $c); }\n`;
    assert.deepEqual(new ValidateStringKeys(syn, store).run(code), []);
  });

  it('리터럴 컴포넌트 호출은 목록에 한 번만 나온다', () => {
    const code = `<?php\nfunction f() { echo get_string('attendance_book', 'local_ubattend'); }\n`;
    assert.equal(new ListResolvedStringCalls(syn, store).run(code).length, 1);
  });
});
