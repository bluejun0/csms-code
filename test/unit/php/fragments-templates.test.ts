import { strict as assert } from 'assert';
import { templateFragments } from '../../../src/infrastructure/php/fragments/templates';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
echo $OUTPUT->render_from_template('local_x/card', $ctx);
$PAGE->requires->js_call_amd('local_x/view', 'init');
$DB->get_record('user', []);
`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(templateFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('templateFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('템플릿 참조', () => {
    assert.equal(f.templateCalls[0].ref, 'local_x/card');
  });
  it('AMD 참조', () => {
    assert.equal(f.amdCalls[0].ref, 'local_x/view');
  });
  it('관심 없는 메서드는 담지 않는다', () => {
    assert.equal(f.templateCalls.length + f.amdCalls.length, 2);
  });
});
