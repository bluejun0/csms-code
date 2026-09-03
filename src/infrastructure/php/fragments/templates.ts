import { QueryFragment } from '../query-fragment';

const TEMPLATE_METHOD = 'render_from_template';
const AMD_METHOD = 'js_call_amd';

const firstStringArgument: QueryFragment = {
  produces: ['templateCalls', 'amdCalls'],
  pattern: `(member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @ref))))`,
  collect: (at, into) => {
    const method = at.text('method');
    if (method !== TEMPLATE_METHOD && method !== AMD_METHOD) return;
    const call = {
      ref: at.text('ref'),
      refLine: at.line('ref'), refColumn: at.column('ref'), refIndex: at.index('ref'),
      index: at.index('method'),
    };
    into.add(method === TEMPLATE_METHOD ? 'templateCalls' : 'amdCalls', call);
  },
};

export const templateFragments: readonly QueryFragment[] = [firstStringArgument];
