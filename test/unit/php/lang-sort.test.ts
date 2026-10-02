import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { langLensLine } from '../../../src/domain/lang-model/services/lang-lens-line';
import { compareLangKeys, missingTranslations, sortAlphabetically, sortInEnglishOrder, TextReplacement } from '../../../src/domain/lang-model/services/lang-string-sorter';
import { parseLangFile } from '../../../src/infrastructure/lang/lang-file-parser';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

const HEADER = `<?php
// This file is part of Moodle.

defined('MOODLE_INTERNAL') || die();

`;

const applied = (text: string, change: TextReplacement | null) =>
  change ? text.slice(0, change.start) + change.replacement + text.slice(change.end) : null;

describe('compareLangKeys', () => {
  it('코드 단위 순서: 접두사가 먼저, `:` < 대문자 < `_` < 소문자', () => {
    const keys = ['ab', 'a_b', 'aB', 'a:b', 'a'];
    assert.deepEqual([...keys].sort(compareLangKeys), ['a', 'a:b', 'aB', 'a_b', 'ab']);
  });
});

describe('lang 문자열 명령', () => {
  let syntax: TreeSitterPhpSyntax;
  before(async () => { syntax = await TreeSitterPhpSyntax.create(); });
  const layoutOf = (text: string) => syntax.langLayout(text)!;
  const alpha = (text: string) => applied(text, sortAlphabetically(text, layoutOf(text)));
  const asEnglish = (text: string, english: string) =>
    applied(text, sortInEnglishOrder(text, layoutOf(text), layoutOf(english)));
  const withMissing = (text: string, english: string) => {
    const m = missingTranslations(text, layoutOf(text), english, layoutOf(english));
    return m && { text: text.slice(0, m.insertAt) + m.insertion + text.slice(m.insertAt), count: m.count };
  };

  describe('알파벳순 정렬', () => {
    it('머리말은 제자리, 문자열은 키 순', () => {
      const text = HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';\n$string['c'] = 'C';\n";
      assert.equal(alpha(text), HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n$string['c'] = 'C';\n");
    });

    it('위쪽 주석·빈 줄과 같은 줄의 꼬리 주석이 문자열을 따라간다', () => {
      const text = HEADER + "$string['b'] = 'B'; // 꼬리\n\n// 위 주석\n$string['a'] = 'A';\n";
      assert.equal(alpha(text), HEADER + "\n// 위 주석\n$string['a'] = 'A';\n$string['b'] = 'B'; // 꼬리\n");
    });

    it('첫 문자열 바로 위 주석은 제자리에 남는다', () => {
      const text = HEADER + "// 첫 주석\n$string['b'] = 'B';\n$string['a'] = 'A';\n";
      assert.equal(alpha(text), HEADER + "// 첫 주석\n$string['a'] = 'A';\n$string['b'] = 'B';\n");
    });

    it('여러 줄 값(연결·heredoc)은 통째로 움직인다', () => {
      const text = HEADER + "$string['c'] = 'C1' .\n    'C2';\n$string['b'] = <<<EOT\nB\nEOT;\n$string['a'] = 'A';\n";
      assert.equal(alpha(text), HEADER + "$string['a'] = 'A';\n$string['b'] = <<<EOT\nB\nEOT;\n$string['c'] = 'C1' .\n    'C2';\n");
    });

    it('겹따옴표 키와 .= 문장도 대상', () => {
      const text = HEADER + "$string[\"b\"] = \"B\";\n$string['a'] = 'A';\n$string['a'] .= '!';\n";
      assert.equal(alpha(text), HEADER + "$string['a'] = 'A';\n$string['a'] .= '!';\n$string[\"b\"] = \"B\";\n");
    });

    it('deprecated 주석 뒤는 손대지 않는다', () => {
      const tail = "\n// Deprecated since Moodle 4.0.\n$string['z'] = 'Z';\n$string['y'] = 'Y';\n";
      const text = HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';\n" + tail;
      assert.equal(alpha(text), HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n" + tail);
    });

    it('앞 문장 꼬리의 deprecated 주석도 다음 문자열부터 끊는다', () => {
      const text = HEADER + "$string['b'] = 'B';\n$string['a'] = 'A'; // deprecated\n$string['d'] = 'D';\n$string['c'] = 'C';\n";
      assert.equal(alpha(text), HEADER + "$string['a'] = 'A'; // deprecated\n$string['b'] = 'B';\n$string['d'] = 'D';\n$string['c'] = 'C';\n");
    });

    it('마지막 문자열이 파일 끝 개행 없이 끝나면 옮길 때 개행을 붙인다', () => {
      const text = HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';";
      assert.equal(alpha(text), HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n");
    });

    it('CRLF를 보존한다', () => {
      const crlf = (s: string) => s.replace(/\n/g, '\r\n');
      const text = crlf(HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';");
      assert.equal(alpha(text), crlf(HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n"));
    });

    it('같은 키는 원래 순서를 지킨다', () => {
      const text = HEADER + "$string['b'] = '1';\n$string['a'] = 'A';\n$string['b'] = '2';\n";
      assert.equal(alpha(text), HEADER + "$string['a'] = 'A';\n$string['b'] = '1';\n$string['b'] = '2';\n");
    });

    it('이미 정렬돼 있으면 텍스트가 그대로다', () => {
      const text = HEADER + "$string['a'] = 'A';\n$string['b'] = 'B';\n";
      assert.equal(alpha(text), text);
    });

    it('한 줄의 두 문장은 갈라 놓고, 사이 공백은 앞에 남는다', () => {
      const text = HEADER + "$string['b'] = 'B'; $string['a'] = 'A';\n";
      assert.equal(alpha(text), HEADER + " $string['a'] = 'A';\n$string['b'] = 'B';\n");
    });

    it('`?>` 바로 앞 문자열은 태그를 데리고 움직인다', () => {
      const text = HEADER + "$string['b'] = 'B';\n$string['a'] = 'A';?>\n";
      assert.equal(alpha(text), HEADER + "$string['a'] = 'A';?>\n$string['b'] = 'B';\n");
    });

    it('블록 안의 대입은 대상이 아니다', () => {
      const block = "if (true) {\n    $string['a'] = 'A';\n}\n";
      const text = HEADER + "$string['c'] = 'C';\n" + block + "$string['b'] = 'B';\n";
      assert.equal(alpha(text), HEADER + block + "$string['b'] = 'B';\n$string['c'] = 'C';\n");
    });

    it('문자열이 없거나 문법 오류가 있으면 아무것도 하지 않는다', () => {
      assert.equal(alpha(HEADER), null);
      assert.equal(alpha(HEADER + "$string['b'] = 'B';\n$string['a'] = ;\n"), null);
    });
  });

  describe('영어 파일 순서로 정렬', () => {
    const english = HEADER + "$string['c'] = 'C';\n$string['a'] = 'A';\n// Deprecated\n$string['b'] = 'B';\n";

    it('영어 파일의 키 순서를 따르고 deprecated 뒤도 옮긴다. 영어에 없는 키는 원래 순서대로 맨 뒤', () => {
      const text = HEADER + "$string['x'] = 'X';\n$string['b'] = 'ㄴ';\n$string['a'] = 'ㄱ';\n$string['c'] = 'ㄷ';\n";
      assert.equal(asEnglish(text, english),
        HEADER + "$string['c'] = 'ㄷ';\n$string['a'] = 'ㄱ';\n$string['b'] = 'ㄴ';\n$string['x'] = 'X';\n");
    });

    it('문자열이 없으면 아무것도 하지 않는다', () => assert.equal(asEnglish(HEADER, english), null));
  });

  describe('누락 번역 추가', () => {
    const english = HEADER + "$string['a'] = 'A';\n\n// b 설명\n$string['b'] = 'B';\n$string['c'] = 'C';";

    it('영어에만 있는 문자열을 위 주석과 함께 마지막 비어 있지 않은 줄 뒤에 붙인다', () => {
      const text = HEADER + "$string['a'] = 'ㄱ';\n\n\n";
      assert.deepEqual(withMissing(text, english), {
        text: HEADER + "$string['a'] = 'ㄱ';\n\n\n// b 설명\n$string['b'] = 'B';\n$string['c'] = 'C';\n\n\n", count: 2,
      });
    });

    it('파일 끝에 개행이 없으면 하나를 더 넣는다', () => {
      const text = HEADER + "$string['a'] = 'ㄱ';";
      assert.equal(withMissing(text, english)?.text,
        HEADER + "$string['a'] = 'ㄱ';\n\n\n// b 설명\n$string['b'] = 'B';\n$string['c'] = 'C';\n");
    });

    it('누락이 없으면 null', () =>
      assert.equal(withMissing(HEADER + "$string['c'] = '';\n$string['b'] = '';\n$string['a'] = '';\n", english), null));
  });

  describe('버튼 줄', () => {
    const lensLine = (text: string) => langLensLine(text, layoutOf(text));

    it('첫 문자열의 키 줄', () => assert.equal(lensLine(HEADER + "$string['a'] = 'A';\n"), 5));
    it('문자열이 없고 끝에 빈 줄이 있으면 마지막 줄', () => assert.equal(lensLine(HEADER), 5));
    it('문자열이 없고 끝에 빈 줄이 없으면 둘째 줄 이후의 첫 코드', () =>
      assert.equal(lensLine("<?php\n// c\ndefined('MOODLE_INTERNAL') || die();"), 2));
    it('그것도 없으면 마지막 주석 덩어리의 첫 주석', () =>
      assert.equal(lensLine('<?php // a\n// b\n\n// c\n// d'), 3));
  });
});

// CSMS_CORPUS의 모든 lang 파일에서 정렬이 텍스트를 잃지 않는지 본다: 줄 집합·키→값이 같고, 다시 정렬하면 그대로다.
describe('알파벳순 정렬 — 코퍼스 불변식(CSMS_CORPUS)', () => {
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
      const after = applied(text, sortAlphabetically(text, syntax.langLayout(text)!));
      if (after === null || after === text) continue;
      changed++;
      assert.deepEqual(lineBag(after), lineBag(text), file);
      assert.deepEqual(valuesByKey(after), valuesByKey(text), file);
      assert.equal(applied(after, sortAlphabetically(after, syntax.langLayout(after)!)), after, file);
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
