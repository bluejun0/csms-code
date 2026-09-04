import { configFunctionKind } from '../../../domain/code-analysis/config-functions';
import { QueryFragment } from '../query-fragment';
import { DYNAMIC_COMPONENT_ARG, componentRefOf } from './strings';

// 함수명 필터는 쿼리 술어가 아니라 collect()에서 수행한다 — top-level 패턴 밖의 술어는 이 grammar/runtime 조합에서 무시되기 때문이다.
function literalConfig(pattern: string, kind: 'get' | 'set'): QueryFragment {
  return {
    produces: ['configCalls'],
    pattern,
    collect: (at, into) => {
      if (configFunctionKind(at.text('fn')) !== kind) return;
      into.add('configCalls', {
        plugin: at.text('plugin'), key: at.text('key'), kind,
        keyLine: at.line('key'), keyColumn: at.column('key'), keyIndex: at.index('key'),
        index: at.index('fn'),
      });
    },
  };
}

function dynamicConfig(pattern: string, kind: 'get' | 'set'): QueryFragment {
  return {
    produces: ['dynamicConfigCalls'],
    pattern,
    collect: (at, into) => {
      if (configFunctionKind(at.text('fn')) !== kind) return;
      const comp = componentRefOf(at);
      if (!comp) return;
      into.add('dynamicConfigCalls', {
        key: at.text('key'), comp, kind,
        keyLine: at.line('key'), keyColumn: at.column('key'), keyIndex: at.index('key'),
        index: at.index('fn'), scope: at.scope('fn'),
      });
    },
  };
}

export const configFragments: readonly QueryFragment[] = [
  literalConfig(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @plugin)) . (argument (string (string_content) @key))))`, 'get'),
  literalConfig(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument) . (argument (string (string_content) @plugin))))`, 'set'),
  dynamicConfig(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument ${DYNAMIC_COMPONENT_ARG}) . (argument (string (string_content) @key))))`, 'get'),
  dynamicConfig(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument) . (argument ${DYNAMIC_COMPONENT_ARG})))`, 'set'),
];
