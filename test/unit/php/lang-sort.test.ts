import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { compareLangKeys, sortLangStrings } from '../../../src/domain/lang-model/services/lang-string-sorter';
import { parseLangFile } from '../../../src/infrastructure/lang/lang-file-parser';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

const HEADER = `<?php
// This file is part of Moodle.

defined('MOODLE_INTERNAL') || die();

`;

describe('compareLangKeys', () => {
  it('코드 단위 순서: 접두사가 먼저, `:` < 대문자 < `_` < 소문자', () => {
    const keys = ['ab', 'a_b', 'aB', 'a:b', 'a'];
    assert.deepEqual([...keys].sort(compareLangKeys), ['a', 'a:b', 'aB', 'a_b', 'ab']);
  });
});

describe('sortLangStrings', () => {
  let syntax: TreeSitterPhpSyntax;
  before(async () => { syntax = await TreeSitterPhpSyntax.create(); });

  const sort = (text: string) => sortLangStrings(text, syntax.langLayout(text)!);
  const sorted = (text: string): string => {
    const r = sort(text);
    assert.equal(r.kind, 'sorted');
    if (r.kind !== 'sorted') throw new Error();
    return text.slice(0, r.start) + r.replacement + text.slice(r.end);
  };

  it('머리말은 제자리, 문자열은 키 순', () => {
    const text = HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';\n$string['c'] = 'C';\n";
    assert.equal(sorted(text), HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n$string['c'] = 'C';\n");
  });

  it('위쪽 주석·빈 줄과 같은 줄의 꼬리 주석이 문자열을 따라간다', () => {
    const text = HEADER + "$string['b'] = 'B'; // 꼬리\n\n// 위 주석\n$string['a'] = 'A';\n";
    assert.equal(sorted(text), HEADER + "\n// 위 주석\n$string['a'] = 'A';\n$string['b'] = 'B'; // 꼬리\n");
  });

  it('여러 줄 값(연결·heredoc)은 통째로 움직인다', () => {
    const text = HEADER + "$string['c'] = 'C1' .\n    'C2';\n$string['b'] = <<<EOT\nB\nEOT;\n$string['a'] = 'A';\n";
    assert.equal(sorted(text), HEADER + "$string['a'] = 'A';\n$string['b'] = <<<EOT\nB\nEOT;\n$string['c'] = 'C1' .\n    'C2';\n");
  });

  it('겹따옴표 키와 .= 문장도 정렬 대상', () => {
    const text = HEADER + "$string[\"b\"] = \"B\";\n$string['a'] = 'A';\n$string['a'] .= '!';\n";
    assert.equal(sorted(text), HEADER + "$string['a'] = 'A';\n$string['a'] .= '!';\n$string[\"b\"] = \"B\";\n");
  });

  it('deprecated 주석 뒤는 손대지 않는다', () => {
    const tail = "\n// Deprecated since Moodle 4.0.\n$string['z'] = 'Z';\n$string['y'] = 'Y';\n";
    const text = HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';\n" + tail;
    assert.equal(sorted(text), HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n" + tail);
  });

  it('마지막 문자열이 파일 끝 개행 없이 끝나면 옮길 때 개행을 붙인다', () => {
    const text = HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';";
    assert.equal(sorted(text), HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n");
  });

  it('CRLF를 보존한다', () => {
    const crlf = (s: string) => s.replace(/\n/g, '\r\n');
    const text = crlf(HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';");
    assert.equal(sorted(text), crlf(HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n"));
  });

  it('같은 키는 원래 순서를 지킨다', () => {
    const text = HEADER + "$string['b'] = '1';\n$string['a'] = 'A';\n$string['b'] = '2';\n";
    assert.equal(sorted(text), HEADER + "$string['a'] = 'A';\n$string['b'] = '1';\n$string['b'] = '2';\n");
  });

  it('이미 정렬돼 있으면 already-sorted', () =>
    assert.deepEqual(sort(HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n"), { kind: 'already-sorted' }));

  it('문자열이 없으면 no-strings', () =>
    assert.deepEqual(sort(HEADER), { kind: 'unsortable', reason: 'no-strings' }));

  it('문법 오류가 있으면 syntax-error', () =>
    assert.deepEqual(sort(HEADER + "$string['b'] = 'B';\n$string['a'] = ;\n"), { kind: 'unsortable', reason: 'syntax-error' }));

  it('한 줄에 문장이 둘이면 shared-line', () =>
    assert.deepEqual(sort(HEADER + "$string['b'] = 'B'; $string['a'] = 'A';\n"), { kind: 'unsortable', reason: 'shared-line' }));

  it('블록 안의 대입은 대상이 아니다', () => {
    const block = "if (true) {\n    $string['a'] = 'A';\n}\n";
    const text = HEADER + "$string['c'] = 'C';\n" + block + "$string['b'] = 'B';\n";
    assert.equal(sorted(text), HEADER + block + "$string['b'] = 'B';\n$string['c'] = 'C';\n");
  });
});

// CSMS_CORPUS의 모든 lang 파일에서 정렬이 텍스트를 잃지 않는지 본다: 줄 집합·키→값이 같고, 다시 정렬하면 그대로다.
describe('sortLangStrings — 코퍼스 불변식(CSMS_CORPUS)', () => {
  const files = corpusLangFiles();
  let syntax: TreeSitterPhpSyntax;
  before(async function () {
    if (!files.length) this.skip();
    syntax = await TreeSitterPhpSyntax.create();
  });

  it('줄 집합·키→값 보존, 멱등', () => {
    let changed = 0;
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const r = sortLangStrings(text, syntax.langLayout(text)!);
      if (r.kind === 'unsortable') assert.equal(r.reason, 'no-strings', file);
      if (r.kind !== 'sorted') continue;
      changed++;
      const after = text.slice(0, r.start) + r.replacement + text.slice(r.end);
      assert.deepEqual(lineBag(after), lineBag(text), file);
      assert.deepEqual(valuesByKey(after), valuesByKey(text), file);
      assert.equal(sortLangStrings(after, syntax.langLayout(after)!).kind, 'already-sorted', file);
    }
    assert.ok(changed > 0);
  });
});

function corpusLangFiles(): string[] {
  const root = process.env.CSMS_CORPUS;
  if (!root || !fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'vendor') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php') && path.basename(path.dirname(path.dirname(p))) === 'lang') out.push(p);
    }
  };
  walk(root);
  return out;
}

function lineBag(text: string): string[] {
  return text.split(/\r?\n/).filter(l => l !== '').sort();
}

function valuesByKey(text: string): Map<string, string> {
  return new Map(parseLangFile(text).map(e => [e.key, e.value]));
}
