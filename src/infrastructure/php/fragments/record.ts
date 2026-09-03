import { QueryFragment } from '../query-fragment';

const WRITE_METHODS = new Set(['insert_record', 'update_record']);

const assignWithTable: QueryFragment = {
  produces: ['assignments'],
  pattern: `(assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method
      arguments: (arguments . (argument (string (string_content) @table)))))`,
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

const dataArg: QueryFragment = {
  produces: ['dataArgBindings'],
  pattern: `(member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @table)) . (argument (variable_name (name) @datavar))))`,
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
