import { strict as assert } from 'assert';
import * as fs from 'fs';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

// 옛 구현(쿼리 27개, 파일당 27회 순회) 대비 목표. 기준선은 같은 파일에서 facts() 17.0ms.
const BUDGET_MS = 8;

describe('facts 예산', () => {
  it('14KB급 파일에서 예산 안에 끝난다', async function () {
    const file = process.env.CSMS_BUDGET_FILE;
    if (!file || !fs.existsSync(file)) this.skip();
    this.timeout(20000);
    const syntax = await TreeSitterPhpSyntax.create();
    const text = fs.readFileSync(file, 'utf8');
    for (let i = 0; i < 5; i++) syntax.facts(text);
    const started = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) syntax.facts(text);
    const each = Number(process.hrtime.bigint() - started) / 1e6 / 20;
    assert.ok(each < BUDGET_MS, `${each.toFixed(2)}ms > ${BUDGET_MS}ms`);
  });
});
