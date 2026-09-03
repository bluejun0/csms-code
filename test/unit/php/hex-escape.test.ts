import { strict as assert } from 'assert';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

const CODE = `<?php
$sep = "\\x1f";
echo get_string('key', 'local_x');
$DB->get_record('user', []);
`;

describe('16진 이스케이프', () => {
  it('이스케이프가 있어도 팩트가 나온다', async () => {
    const syntax = await TreeSitterPhpSyntax.create();
    const f = syntax.facts(CODE);
    assert.equal(f.stringCalls.length, 1);
    assert.ok(f.tableRefs.some(r => r.name === 'user'));
  });
});
