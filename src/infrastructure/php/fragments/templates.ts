import { QueryFragment } from '../query-fragment';

const TEMPLATE_METHOD = 'render_from_template';
const AMD_METHOD = 'js_call_amd';

// 수신자를 제약하지 않아 $OUTPUT->render_from_template과 $PAGE->requires->js_call_amd를 함께 잡는다.
// 체인 형태($PAGE->requires->...)도 수신자 제약이 없어야 매칭된다. 그 대신 첫 인자가 문자열인 모든
// 메서드 호출(예: $DB->get_record)이 매칭되지만, collect()의 메서드명 검사가 불필요한 호출을 걸러낸다.
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
