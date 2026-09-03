import { strict as assert } from 'assert';
import { compareOverFiles, diffFacts } from '../../tools/facts-diff';
import { emptyFacts } from '../../../src/domain/code-analysis/facts';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';
import { TreeSitterPhpSyntax as LegacyPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import * as fs from 'fs';
import * as path from 'path';

describe('facts-diff', () => {
  it('순서만 다른 팩트는 차이가 아니다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    a.tableRefs.push({ name: 'y', nameLine: 2, nameColumn: 0, nameIndex: 20 });
    b.tableRefs.push({ name: 'y', nameLine: 2, nameColumn: 0, nameIndex: 20 });
    b.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    assert.deepEqual(diffFacts(a, b), []);
  });

  it('스코프만 달라도 차이로 잡는다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.plainAssignments.push({ varName: 'x', index: 5, scope: { start: 0, end: 100 } });
    b.plainAssignments.push({ varName: 'x', index: 5, scope: { start: 0, end: 200 } });
    assert.equal(diffFacts(a, b).length, 1);
  });

  it('값이 다르면 차이로 잡는다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    const d = diffFacts(a, b);
    assert.equal(d.length, 1);
    assert.equal(d[0].kind, 'tableRefs');
  });

  it('픽스처 전체에서 옛 구현과 새 구현의 팩트가 같다', async () => {
    const [legacy, next] = await Promise.all([LegacyPhpSyntax.create(), TreeSitterPhpSyntax.create()]);
    const root = path.join(__dirname, '../../fixtures');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p); else if (d.name.endsWith('.php')) files.push(p);
      }
    };
    walk(root);
    // 픽스처가 비거나 전부 파싱 실패하면 아래 diff는 파일 0개를 비교하고도 조용히
    // 통과한다 — 그 공허한 통과를 막기 위해 실제로 팩트가 나왔는지까지 확인한다.
    assert.ok(files.length > 0, '픽스처 PHP 파일이 없다');
    const totalFacts = files.reduce(
      (sum, file) => sum + Object.values(legacy.facts(fs.readFileSync(file, 'utf8'))).reduce((n, list) => n + list.length, 0),
      0,
    );
    assert.ok(totalFacts > 0, '픽스처에서 팩트가 하나도 안 나왔다');
    const differences = compareOverFiles(legacy, next, files);
    assert.deepEqual([...differences.keys()], []);
  });
});
