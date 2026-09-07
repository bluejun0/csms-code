import { literalString } from './literal-string';
import { QueryFragment } from '../query-fragment';

const WRITE_METHODS = new Set(['insert_record', 'update_record']);

const assignWithTable: QueryFragment = {
  produces: ['assignments'],
  pattern: `(assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method
      arguments: (arguments . (argument ${literalString('table')}))))`,
  collect: (at, into) => into.add('assignments', {
    varName: at.text('var'), receiver: at.text('recv'), method: at.text('method'),
    tableArg: at.text('table'), index: at.index('var'), scope: at.scope('var'),
  }),
};

const assignWithoutTable: QueryFragment = {
  produces: ['assignments'],
  pattern: `(assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method))`,
  collect: (at, into) => into.add('assignments', {
    varName: at.text('var'), receiver: at.text('recv'), method: at.text('method'),
    tableArg: null, index: at.index('var'), scope: at.scope('var'),
  }),
};

// assignWithTable가 이미 잡은 대입도 함께 매칭되어 같은 인덱스에 두 항목을 만든다.
// 나중 단계에서 tableArg가 null이 아닌 것을 보관한다.

// 값 변수를 감싸는 노드가 형태마다 다르다 (단순 / $k => $v / &$r / $k => &$v), 그래서 패턴이 네 개다.
// key 변수는 패턴이 정확히 매칭되도록 캡처만 하고, itemVar로 절대 쓰지 않는다.
function foreachFragment(pattern: string): QueryFragment {
  return {
    produces: ['foreachBindings'],
    pattern,
    collect: (at, into) => into.add('foreachBindings', {
      collectionVar: at.text('collection'), itemVar: at.text('item'),
      index: at.index('item'), scope: at.scope('item'),
    }),
  };
}

// 선행 anchor(.)는 테이블 문자열 직후 인자만 캡처하므로 뒤의 인자는 dataVar가 되지 않는다.
// 쓰기 메서드 필터는 쿼리 술어가 아니라 collect()에서 실행된다 — top-level 패턴 밖의 술어는 이 grammar/runtime 조합에서 무시되기 때문이다.
const dataArg: QueryFragment = {
  produces: ['dataArgBindings'],
  pattern: `(member_call_expression
    name: (name) @method
    arguments: (arguments . (argument ${literalString('table')}) . (argument (variable_name (name) @datavar))))`,
  collect: (at, into) => {
    const method = at.text('method');
    if (!WRITE_METHODS.has(method)) return;
    into.add('dataArgBindings', {
      method, tableArg: at.text('table'), dataVar: at.text('datavar'),
      index: at.index('datavar'), scope: at.scope('datavar'),
    });
  },
};

const plainAssign: QueryFragment = {
  produces: ['plainAssignments'],
  pattern: '(assignment_expression left: (variable_name (name) @var))',
  collect: (at, into) => into.add('plainAssignments', {
    varName: at.text('var'), index: at.index('var'), scope: at.scope('var'),
  }),
};

export const recordFragments: readonly QueryFragment[] = [
  assignWithTable,
  assignWithoutTable,
  foreachFragment('(foreach_statement (variable_name (name) @collection) (variable_name (name) @item))'),
  foreachFragment(`(foreach_statement (variable_name (name) @collection)
    (pair (variable_name (name) @key) (variable_name (name) @item)))`),
  foreachFragment(`(foreach_statement (variable_name (name) @collection)
    (by_ref (variable_name (name) @item)))`),
  foreachFragment(`(foreach_statement (variable_name (name) @collection)
    (pair (variable_name (name) @key) (by_ref (variable_name (name) @item))))`),
  dataArg,
  plainAssign,
];
