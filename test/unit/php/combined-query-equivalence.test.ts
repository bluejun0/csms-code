import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { ALL_FRAGMENTS as FRAGMENTS } from '../../../src/infrastructure/php/php-syntax';

function fixturePhpFiles(): string[] {
  const root = path.join(__dirname, '../../fixtures');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php')) out.push(p);
    }
  };
  walk(root);
  return out;
}

function corpusPhpFiles(limit: number): string[] {
  const root = process.env.CSMS_CORPUS;
  if (!root || !fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (out.length >= limit) return;
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'vendor') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php') && fs.statSync(p).size < 200_000) out.push(p);
    }
  };
  walk(root);
  return out;
}

describe('통합 쿼리 등가성', () => {
  let runtime: PhpRuntime;
  let set: FragmentSet;
  let combined: ReturnType<PhpRuntime['compile']>;
  let singles: ReturnType<PhpRuntime['compile']>[];

  before(async () => {
    runtime = await PhpRuntime.create();
    set = FragmentSet.of(FRAGMENTS);
    combined = runtime.compile(set.source);
    singles = FRAGMENTS.map(f => runtime.compile(f.pattern));
  });

  const check = (file: string) => {
    const text = fs.readFileSync(file, 'utf8');
    const doc = runtime.parse(text);
    if (!doc) return;
    const scopes = ScopeTable.of([], doc.endIndex);
    const byPattern = new Map<number, number>();
    for (const m of doc.run(combined, scopes)) {
      byPattern.set(m.patternIndex, (byPattern.get(m.patternIndex) ?? 0) + 1);
    }
    singles.forEach((single, i) => {
      const alone = [...doc.run(single, scopes)].length;
      assert.equal(byPattern.get(i) ?? 0, alone, `${path.basename(file)} 조각 ${i}`);
    });
    doc.dispose();
  };

  it('픽스처 PHP 파일에서 패턴별 매치 수가 같다', () => {
    const files = fixturePhpFiles();
    assert.ok(files.length > 0);
    files.forEach(check);
  });

  it('코퍼스 PHP 파일에서 패턴별 매치 수가 같다', function () {
    const files = corpusPhpFiles(300);
    if (files.length === 0) this.skip();
    files.forEach(check);
  });
});
