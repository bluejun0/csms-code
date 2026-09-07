import { literalString } from './literal-string';
import { Captures, FactSink, QueryFragment } from '../query-fragment';

const BRACED_NAME = /\{(\w+)\}/g;
const SQL_HELPER_PREFIX = 'sql_';

// 줄·컬럼은 노드를 한 번만 훑으며 누적한다 — 매치마다 앞쪽을 되짚으면 매치 수에 대해 제곱이 된다.
// scanned는 매치 사이에 리셋하지 않는다: 다음 매치를 찾을 때 이전 지점부터 이어서 훑어야 선형이 된다.
// lineStart를 노드 시작 컬럼만큼 음수로 시작하면 첫 줄에서도 같은 식(offsetInNode - lineStart)으로
// 문서 컬럼이 나오고, 줄바꿈을 만나 실제 오프셋으로 리셋된 뒤에도 식이 그대로 성립한다.
function collectBracedNames(at: Captures, into: FactSink, capture: string): void {
  const body = at.text(capture);
  if (!body.includes('{')) return;
  const start = at.index(capture);
  let line = at.line(capture);
  let lineStart = -at.column(capture);
  let scanned = 0;
  BRACED_NAME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACED_NAME.exec(body))) {
    const nameOffset = m.index + 1;
    for (; scanned < nameOffset; scanned++) {
      if (body[scanned] === '\n') { line++; lineStart = scanned + 1; }
    }
    into.add('tableRefs', {
      name: m[1], nameLine: line, nameColumn: nameOffset - lineStart, nameIndex: start + nameOffset,
    });
  }
}

// string_content 하나가 단일 인용·이중 인용·heredoc을 모두 덮고, nowdoc만 별도 노드 타입이라 조각이 둘로 나뉜다.
// 부모를 제약하지 않아 인용 형태를 가리지 않고 잡는다 — 이중 인용의 `{$var}` 보간은 별도 노드로
// 쪼개지므로 문자열 내용에 남지 않아 오매칭되지 않는다.
function bracedNamesIn(pattern: string, capture: string): QueryFragment {
  return {
    produces: ['tableRefs'],
    pattern,
    collect: (at, into) => collectBracedNames(at, into, capture),
  };
}

// $DB 메서드의 첫 문자열 인자 — Moodle DML은 여기에 테이블 이름을 받는다.
// sql_like·sql_compare_text 등 sql_ 접두 헬퍼는 첫 인자가 컬럼·식이라 테이블이 아니다.
// 수신자·메서드명 필터는 쿼리 술어가 아니라 collect()에서 실행된다 — top-level 패턴 밖의 술어는
// 이 grammar/runtime 조합에서 무시되기 때문이다.
const dbFirstArgument: QueryFragment = {
  produces: ['tableRefs'],
  pattern: `(member_call_expression
    object: (variable_name (name) @recv)
    name: (name) @method
    arguments: (arguments . (argument ${literalString('table')})))`,
  collect: (at, into) => {
    if (at.text('recv') !== 'DB') return;
    if (at.text('method').startsWith(SQL_HELPER_PREFIX)) return;
    into.add('tableRefs', {
      name: at.text('table'),
      nameLine: at.line('table'), nameColumn: at.column('table'), nameIndex: at.index('table'),
    });
  },
};

export const tableFragments: readonly QueryFragment[] = [
  bracedNamesIn('(string_content) @s', 's'),
  bracedNamesIn('(nowdoc_string) @n', 'n'),
  dbFirstArgument,
];
