import { ComponentRef } from '../../../domain/code-analysis/facts';
import { StringCallForm, effectiveComponent, stringClassForm, stringFunctionForm } from '../../../domain/code-analysis/string-functions';
import { Captures, QueryFragment } from '../query-fragment';

// get_config/set_config(Task 8)도 컴포넌트가 리터럴이 아닐 때 같은 세 형태를 받으므로 여기서 내보내 공유한다.
export const DYNAMIC_COMPONENT_ARG =
  '[(variable_name (name) @dynvar) (member_access_expression object: (variable_name) @dynrecv name: (name) @dynprop) (class_constant_access_expression) @dynconst]';

// 다른 객체($other->comp)의 프로퍼티는 이 파일에서 정의를 알 수 없어 null. X::NAME은 name 노드가
// 둘(클래스·상수)이라 마지막을 쓴다(self::NAME은 하나뿐이라 그대로 마지막이 상수 이름).
export function componentRefOf(at: Captures): ComponentRef | null {
  if (at.has('dynvar')) return { kind: 'var', name: at.text('dynvar') };
  if (at.has('dynprop')) {
    if (at.text('dynrecv') !== '$this') return null;
    return { kind: 'prop', name: at.text('dynprop') };
  }
  if (at.has('dynconst')) {
    const name = at.lastNameIn('dynconst');
    return name ? { kind: 'const', name } : null;
  }
  return null;
}

// 컴포넌트가 리터럴인 문자열 호출 — 함수(get_string 등)·클래스(moodle_exception 등) 두 형태, 각각
// 컴포넌트 인자 유무로 둘씩 — 총 네 조각. 함수/클래스 이름 필터는 술어가 아니라 collect()에서 한다.
function literalCall(pattern: string, formOf: (name: string) => StringCallForm | undefined,
                     nameCapture: string, hasComponent: boolean): QueryFragment {
  return {
    produces: ['stringCalls'],
    pattern,
    collect: (at, into) => {
      const form = formOf(at.text(nameCapture));
      if (!form) return;
      into.add('stringCalls', {
        key: at.text('key'),
        component: effectiveComponent(form, hasComponent ? at.text('component') : ''),
        keyLine: at.line('key'), keyColumn: at.column('key'), keyIndex: at.index('key'),
        index: at.index(nameCapture),
      });
    },
  };
}

// 컴포넌트가 리터럴이 아닌 세 형태 — 표현식 종류가 달라 패턴을 따로 둔다.
function dynamicCall(pattern: string): QueryFragment {
  return {
    produces: ['dynamicStringCalls'],
    pattern,
    collect: (at, into) => {
      if (!stringFunctionForm(at.text('fn'))) return;
      const comp = componentRefOf(at);
      if (!comp) return;
      into.add('dynamicStringCalls', {
        key: at.text('key'), comp,
        keyLine: at.line('key'), keyColumn: at.column('key'), keyIndex: at.index('key'),
        index: at.index('fn'), scope: at.scope('fn'),
      });
    },
  };
}

const literalAssignment: QueryFragment = {
  produces: ['literalAssignments'],
  pattern: '(assignment_expression left: (variable_name (name) @var) right: (string (string_content) @val))',
  collect: (at, into) => into.add('literalAssignments', {
    varName: at.text('var'), value: at.text('val'), index: at.index('var'), scope: at.scope('var'),
  }),
};

const propertyLiteral: QueryFragment = {
  produces: ['propertyLiterals'],
  pattern: `(property_declaration (property_element (variable_name (name) @prop)
    (property_initializer (string (string_content) @value))))`,
  collect: (at, into) => into.add('propertyLiterals', {
    property: at.text('prop'), value: at.text('value'), index: at.index('prop'),
  }),
};

const constLiteral: QueryFragment = {
  produces: ['constLiterals'],
  pattern: '(const_declaration (const_element (name) @cname (string (string_content) @cval)))',
  collect: (at, into) => into.add('constLiterals', {
    name: at.text('cname'), value: at.text('cval'), index: at.index('cname'),
  }),
};

export const stringFragments: readonly QueryFragment[] = [
  literalCall(`(function_call_expression
    function: (name) @fn
    arguments: (arguments
      . (argument (string (string_content) @key))
      . (argument (string (string_content) @component))))`, stringFunctionForm, 'fn', true),
  // 한 인자 호출 — 끝의 anchor(.)가 인자 하나짜리 호출만 매칭시킨다. 없으면 두 인자 호출에도
  // 매칭되어 기본 컴포넌트로 잘못된 팩트가 하나 더 생긴다.
  literalCall(`(function_call_expression
    function: (name) @fn
    arguments: (arguments . (argument (string (string_content) @key)) .))`, stringFunctionForm, 'fn', false),
  literalCall(`(object_creation_expression
    [(name) @cls (qualified_name (name) @cls)]
    (arguments
      . (argument (string (string_content) @key))
      . (argument (string (string_content) @component))))`, stringClassForm, 'cls', true),
  literalCall(`(object_creation_expression
    [(name) @cls (qualified_name (name) @cls)]
    (arguments . (argument (string (string_content) @key)) .))`, stringClassForm, 'cls', false),
  dynamicCall(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument (variable_name (name) @dynvar))))`),
  dynamicCall(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key))
    . (argument (member_access_expression object: (variable_name) @dynrecv name: (name) @dynprop))))`),
  dynamicCall(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument (class_constant_access_expression) @dynconst)))`),
  literalAssignment,
  propertyLiteral,
  constLiteral,
];
