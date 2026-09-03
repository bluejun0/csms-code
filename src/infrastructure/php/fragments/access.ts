import { QueryFragment } from '../query-fragment';

const PHPDOC_VAR = /@var\s+([^\s]+)\s+\$(\w+)/g;

const propertyAccess: QueryFragment = {
  produces: ['propertyAccesses'],
  pattern: '(member_access_expression object: (variable_name (name) @var) name: (name) @prop)',
  collect: (at, into) => into.add('propertyAccesses', {
    varName: at.text('var'), property: at.text('prop'),
    propLine: at.line('prop'), propColumn: at.column('prop'), propIndex: at.index('prop'),
    index: at.index('var'), scope: at.scope('var'),
  }),
};

const methodCall: QueryFragment = {
  produces: ['methodCalls'],
  pattern: '(member_call_expression object: (variable_name (name) @var) name: (name) @method)',
  collect: (at, into) => into.add('methodCalls', {
    varName: at.text('var'), method: at.text('method'),
    nameLine: at.line('method'), nameColumn: at.column('method'), nameIndex: at.index('method'),
    index: at.index('var'), scope: at.scope('var'),
  }),
};

// 트리시터가 phpdoc 내부를 파싱하지 않으므로 주석 노드 텍스트에 정규식을 돌린다.
const phpdocVars: QueryFragment = {
  produces: ['phpdocVars'],
  pattern: '(comment) @c',
  collect: (at, into) => {
    const index = at.index('c');
    const scope = at.scope('c');
    const text = at.text('c');
    PHPDOC_VAR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PHPDOC_VAR.exec(text))) {
      into.add('phpdocVars', { typeText: m[1], varName: m[2], index, scope });
    }
  },
};

export const accessFragments: readonly QueryFragment[] = [propertyAccess, methodCall, phpdocVars];
