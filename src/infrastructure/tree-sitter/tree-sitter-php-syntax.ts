import * as path from 'path';
import Parser from 'web-tree-sitter';
import {
  AmdCall, DocumentFacts, emptyFacts, RecordAssignment, ForeachBinding, DataArgBinding, PhpdocVar, PlainAssignment, PropertyAccess, Scope, StringCall, TableRef, TemplateCall,
} from '../../domain/code-analysis/facts';
import { PhpSyntax } from '../../domain/code-analysis/ports/php-syntax';

const SCOPE_TYPES = new Set([
  'function_definition', 'method_declaration',
  'anonymous_function_creation_expression', 'arrow_function',
]);

const Q_ASSIGN = `
  (assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method
      arguments: (arguments . (argument (string (string_content) @table)))))`;
const Q_ASSIGN_NOTABLE = `
  (assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method))`;
// foreach: 4가지 형태를 각각 별도 쿼리로 잡는다 — 값 변수를 감싸는 노드가 형태마다 다르다.
//   - 단순: foreach ($rows as $r)                     → (foreach_statement (variable_name) (variable_name @item))
//   - key=>value: foreach ($rows as $k => $v)         → (foreach_statement (variable_name) (pair (variable_name @key) (variable_name @item)))
//   - by-ref: foreach ($rows as &$r)                  → (foreach_statement (variable_name) (by_ref (variable_name @item)))
//   - key=>&value: foreach ($rows as $k => &$v)       → (foreach_statement (variable_name) (pair (variable_name @key) (by_ref (variable_name @item))))
// key 변수는 레코드가 아니므로 캡처만 하고(패턴을 정확히 매칭시키기 위해) itemVar로는 절대 쓰지 않는다.
const Q_FOREACH_SIMPLE = `
  (foreach_statement (variable_name (name) @collection) (variable_name (name) @item))`;
const Q_FOREACH_PAIR = `
  (foreach_statement (variable_name (name) @collection)
    (pair (variable_name (name) @key) (variable_name (name) @item)))`;
const Q_FOREACH_BYREF = `
  (foreach_statement (variable_name (name) @collection)
    (by_ref (variable_name (name) @item)))`;
const Q_FOREACH_PAIR_BYREF = `
  (foreach_statement (variable_name (name) @collection)
    (pair (variable_name (name) @key) (by_ref (variable_name (name) @item))))`;
const Q_PROP = `
  (member_access_expression object: (variable_name (name) @var) name: (name) @prop)`;
// dataArg: 테이블 문자열 바로 다음(anchor .) 위치 인자만 datavar로 잡는다 — 3번째 이상 인자는 매칭되지 않는다.
// 메서드는 insert_record/update_record(쓰기)만 허용하는데, 이 grammar/버전에서 술어(#any-of? 등)가
// top-level 패턴 밖에 있으면 무시되므로, 메서드 필터링은 캡처 후 코드에서 수행한다.
const Q_DATAARG = `
  (member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @table)) . (argument (variable_name (name) @datavar))))`;
const DATAARG_WRITE_METHODS = new Set(['insert_record', 'update_record']);
// kill-on-reassign: LHS가 단순 변수인 모든 대입(RHS 무관). 레코드 대입도 포함된다(추론이 index 동일성으로 처리).
const Q_PLAIN_ASSIGN = `
  (assignment_expression left: (variable_name (name) @var))`;

// get_string('key','component') 리터럴 호출 — 함수명 필터는 캡처 후 코드에서 한다(술어 미지원).
// 변수 키/컴포넌트·보간 문자열은 string_content 캡처가 없어 매칭 자체가 안 된다(자연 침묵).
const Q_STRING_CALL = `
  (function_call_expression
    function: (name) @fn
    arguments: (arguments
      . (argument (string (string_content) @key))
      . (argument (string (string_content) @component))))`;

// 첫 인자가 문자열 리터럴인 메서드 호출 — 수신자를 제약하지 않아 $OUTPUT->render_from_template와
// $PAGE->requires->js_call_amd를 함께 잡는다. 종류는 메서드명으로 가른다.
// 동적 인자는 string_content가 없어 비매칭이다.
const Q_TEMPLATE_CALL = `
  (member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @ref))))`;

// 문자열 내용 노드. string_content 하나가 단일 인용·이중 인용·heredoc를 모두 덮고, nowdoc만 별도 타입이다.
// 이중 인용에서 `{$var}` 보간은 별도 노드로 쪼개지므로 문자열 내용에 남지 않는다.
const Q_STRING_BODY = `
  (string_content) @s
  (nowdoc_string) @s`;
const TABLE_REF_RE = /\{(\w+)\}/g;

interface CompiledQueries {
  assign: Parser.Query;
  assignNoTable: Parser.Query;
  foreachSimple: Parser.Query;
  foreachPair: Parser.Query;
  foreachByRef: Parser.Query;
  foreachPairByRef: Parser.Query;
  prop: Parser.Query;
  dataArg: Parser.Query;
  plainAssign: Parser.Query;
  stringCall: Parser.Query;
  templateCall: Parser.Query;
  stringBody: Parser.Query;
}

export class TreeSitterPhpSyntax implements PhpSyntax {
  private constructor(private parser: Parser, private queries: CompiledQueries) {}

  /** runtimeDir: tree-sitter.wasm + tree-sitter-php.wasm 이 있는 폴더(dist). 테스트에선 node_modules. */
  static async create(runtimeDir?: string): Promise<TreeSitterPhpSyntax> {
    const rt = runtimeDir ?? path.join(__dirname, '../../../node_modules/web-tree-sitter');
    const phpWasm = runtimeDir
      ? path.join(runtimeDir, 'tree-sitter-php.wasm')
      : path.join(__dirname, '../../../node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm');
    await Parser.init({ locateFile: (f: string) => path.join(rt, f) });
    const lang = await Parser.Language.load(phpWasm);
    const parser = new Parser(); parser.setLanguage(lang);
    // 쿼리는 인스턴스당 1회만 컴파일해 재사용한다 — facts() 호출마다 재컴파일하면 WASM 힙이 계속 늘어난다.
    const queries: CompiledQueries = {
      assign: lang.query(Q_ASSIGN),
      assignNoTable: lang.query(Q_ASSIGN_NOTABLE),
      foreachSimple: lang.query(Q_FOREACH_SIMPLE),
      foreachPair: lang.query(Q_FOREACH_PAIR),
      foreachByRef: lang.query(Q_FOREACH_BYREF),
      foreachPairByRef: lang.query(Q_FOREACH_PAIR_BYREF),
      prop: lang.query(Q_PROP),
      dataArg: lang.query(Q_DATAARG),
      plainAssign: lang.query(Q_PLAIN_ASSIGN),
      stringCall: lang.query(Q_STRING_CALL),
      templateCall: lang.query(Q_TEMPLATE_CALL),
      stringBody: lang.query(Q_STRING_BODY),
    };
    return new TreeSitterPhpSyntax(parser, queries);
  }

  /** 이 grammar/런타임 조합은 16진 이스케이프(`"\x00"`)가 있는 문서에서 파싱이 실패한다.
   *  중단된 파싱은 파서에 내부 상태를 남기고, 그대로 두면 **다음 문서**가 예외 없이
   *  잘못된 트리로 파싱된다(누락된 노드·거짓 오류). 그래서 실패 즉시 reset()으로 상태를 버린다. */
  private parseOrNull(text: string): Parser.Tree | null {
    try {
      return this.parser.parse(text);
    } catch {
      this.parser.reset();
      console.warn('CSMS Code: PHP 파싱에 실패해 이 파일의 인텔리전스를 건너뜁니다.');
      return null;
    }
  }

  facts(text: string): DocumentFacts {
    const tree = this.parseOrNull(text);
    // 파싱 불가 문서는 팩트 없음(=침묵)으로 떨어뜨린다. 예외를 밖으로 던지면 그 파일에서
    // 모든 프로바이더가 실패한다.
    if (!tree) return emptyFacts();
    const root = tree.rootNode;
    const scopeOf = (node: Parser.SyntaxNode): Scope => {
      let p: Parser.SyntaxNode | null = node;
      while (p) { if (SCOPE_TYPES.has(p.type)) return { start: p.startIndex, end: p.endIndex }; p = p.parent; }
      return { start: 0, end: root.endIndex };
    };
    const capMap = (caps: { name: string; node: Parser.SyntaxNode }[]) => {
      const m = new Map<string, Parser.SyntaxNode>();
      for (const c of caps) m.set(c.name, c.node);
      return m;
    };
    // matches() 로 한 매치 내 캡처들을 묶는다 (쿼리 객체는 캐시된 것을 사용, 매 호출 재컴파일하지 않음)
    const runMatches = (q: Parser.Query) => q.matches(root).map(mt => ({ caps: capMap(mt.captures) }));

    const assignments: RecordAssignment[] = [];
    for (const { caps } of runMatches(this.queries.assign)) {
      const varN = caps.get('var')!, recv = caps.get('recv')!, method = caps.get('method')!, table = caps.get('table');
      assignments.push({ varName: varN.text, receiver: recv.text, method: method.text,
        tableArg: table ? table.text : null, index: varN.startIndex, scope: scopeOf(varN) });
    }
    // 테이블 인자가 없는(get_record_sql 등) 대입도 잡아, 이미 잡힌 var는 제외
    const seen = new Set(assignments.map(a => a.index));
    for (const { caps } of runMatches(this.queries.assignNoTable)) {
      const varN = caps.get('var')!;
      if (seen.has(varN.startIndex)) continue;
      assignments.push({ varName: varN.text, receiver: caps.get('recv')!.text, method: caps.get('method')!.text,
        tableArg: null, index: varN.startIndex, scope: scopeOf(varN) });
    }

    // foreach: 4가지 형태를 모두 돌려 병합한다. key 변수는 버리고 value(레코드) 변수만 itemVar로 취급.
    // 같은 foreach가 두 형태에 동시에 매칭될 일은 노드 구조상 없지만(직속 자식이 variable_name/pair/by_ref 중 하나로 고정),
    // 방어적으로 item 위치(index) 기준 중복 제거를 해둔다.
    const foreachBindings: ForeachBinding[] = [];
    const foreachSeen = new Set<number>();
    const foreachQueries = [this.queries.foreachSimple, this.queries.foreachPair, this.queries.foreachByRef, this.queries.foreachPairByRef];
    for (const q of foreachQueries) {
      for (const { caps } of runMatches(q)) {
        const item = caps.get('item')!;
        if (foreachSeen.has(item.startIndex)) continue;
        foreachSeen.add(item.startIndex);
        foreachBindings.push({ collectionVar: caps.get('collection')!.text, itemVar: item.text, index: item.startIndex, scope: scopeOf(item) });
      }
    }

    // dataArg: 쓰기 메서드(insert_record/update_record)만, 테이블 문자열 바로 다음 2번째 위치 인자만 남긴다.
    const dataArgBindings: DataArgBinding[] = [];
    for (const { caps } of runMatches(this.queries.dataArg)) {
      const method = caps.get('method')!;
      if (!DATAARG_WRITE_METHODS.has(method.text)) continue;
      const dv = caps.get('datavar')!;
      dataArgBindings.push({ method: method.text, tableArg: caps.get('table')!.text, dataVar: dv.text, index: dv.startIndex, scope: scopeOf(dv) });
    }

    const plainAssignments: PlainAssignment[] = [];
    for (const { caps } of runMatches(this.queries.plainAssign)) {
      const varN = caps.get('var')!;
      plainAssignments.push({ varName: varN.text, index: varN.startIndex, scope: scopeOf(varN) });
    }

    const stringCalls: StringCall[] = [];
    for (const { caps } of runMatches(this.queries.stringCall)) {
      const fn = caps.get('fn')!;
      if (fn.text !== 'get_string') continue;
      const key = caps.get('key')!, component = caps.get('component')!;
      stringCalls.push({
        key: key.text, component: component.text,
        keyLine: key.startPosition.row, keyColumn: key.startPosition.column, keyIndex: key.startIndex,
        index: fn.startIndex,
      });
    }

    const templateCalls: TemplateCall[] = [];
    const amdCalls: AmdCall[] = [];
    for (const { caps } of runMatches(this.queries.templateCall)) {
      const method = caps.get('method')!;
      // 이 쿼리는 첫 인자가 문자열인 모든 메서드 호출($DB->get_record 등)에 매칭된다 —
      // 관심 있는 메서드가 아니면 객체를 만들기 전에 빠진다.
      if (method.text !== 'render_from_template' && method.text !== 'js_call_amd') continue;
      const ref = caps.get('ref')!;
      const call = {
        ref: ref.text,
        refLine: ref.startPosition.row, refColumn: ref.startPosition.column, refIndex: ref.startIndex,
        index: method.startIndex,
      };
      if (method.text === 'render_from_template') templateCalls.push(call);
      else amdCalls.push(call);
    }

    // Moodle SQL은 테이블을 `{name}`으로 적는다. 이름이 실제 테이블인지는 색인이 판정하므로
    // 여기서는 SQL 여부를 가리지 않고 형태만 뽑는다.
    const tableRefs: TableRef[] = [];
    for (const { caps } of runMatches(this.queries.stringBody)) {
      const node = caps.get('s')!;
      const body = node.text;
      if (!body.includes('{')) continue;
      // 줄·컬럼은 노드를 한 번만 훑으며 누적한다. 매치마다 앞쪽을 되짚으면 매치 수에 대해 제곱이 된다.
      // lineStart를 노드의 시작 컬럼만큼 음수로 시작하면 첫 줄에서도 같은 식으로 문서 컬럼이 나오고,
      // 줄바꿈을 만나 0 기준으로 리셋된 뒤에도 식이 그대로 성립한다.
      let line = node.startPosition.row;
      let lineStart = -node.startPosition.column;
      let scanned = 0;
      TABLE_REF_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TABLE_REF_RE.exec(body))) {
        const nameOffset = m.index + 1;
        for (; scanned < nameOffset; scanned++) {
          if (body[scanned] === '\n') { line++; lineStart = scanned + 1; }
        }
        tableRefs.push({
          name: m[1], nameLine: line, nameColumn: nameOffset - lineStart,
          nameIndex: node.startIndex + nameOffset,
        });
      }
    }

    const propertyAccesses: PropertyAccess[] = runMatches(this.queries.prop).map(({ caps }) => {
      const v = caps.get('var')!, p = caps.get('prop')!;
      return { varName: v.text, property: p.text, propLine: p.startPosition.row, propColumn: p.startPosition.column,
        propIndex: p.startIndex, index: v.startIndex, scope: scopeOf(v) };
    });

    const phpdocVars = extractPhpdocVars(text, root, scopeOf);

    // 위에서 모든 캡처를 plain 값(text/index/scope 등)으로 옮겨 담았으므로, 이제 트리를 해제해도
    // 반환하는 팩트 객체는 안전하다(트리 노드에 대한 참조를 들고 있지 않음). 호출마다 트리를 쌓아두지 않도록 해제한다.
    tree.delete();

    return { assignments, foreachBindings, dataArgBindings, phpdocVars, propertyAccesses, plainAssignments, stringCalls, templateCalls, amdCalls, tableRefs };
  }
}

/** @var Type $x — comment 노드 텍스트에 정규식(트리시터가 phpdoc 내부를 파싱 안 함) */
function extractPhpdocVars(text: string, root: Parser.SyntaxNode, scopeOf: (n: Parser.SyntaxNode) => Scope): PhpdocVar[] {
  const out: PhpdocVar[] = [];
  const re = /@var\s+([^\s]+)\s+\$(\w+)/g;
  const walk = (n: Parser.SyntaxNode) => {
    if (n.type === 'comment') {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(n.text))) out.push({ typeText: m[1], varName: m[2], index: n.startIndex, scope: scopeOf(n) });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  };
  walk(root);
  return out;
}
