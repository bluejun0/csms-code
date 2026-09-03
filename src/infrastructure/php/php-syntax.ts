import { DocumentFacts, RecordAssignment, emptyFacts } from '../../domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../domain/code-analysis/ports/php-syntax';
import { readClassMembers } from './class-members';
import { FragmentSet } from './fragment-set';
import { accessFragments } from './fragments/access';
import { configFragments } from './fragments/config';
import { recordFragments } from './fragments/record';
import { stringFragments } from './fragments/strings';
import { tableFragments } from './fragments/tables';
import { templateFragments } from './fragments/templates';
import { FactKind, QueryFragment } from './query-fragment';
import { ScopeTable } from './scope-table';
import { CompiledQuery, PhpRuntime } from './tree-sitter-runtime';

// 363KB 문서 기준 파싱 약 62ms + 질의 약 26ms. 이보다 큰 문서는 대개 벤더 코드라 인텔리전스가
// 필요 없고, 편집기를 막지 않도록 팩트 없음으로 떨어뜨린다(파싱 실패와 동일하게 침묵 처리).
export const MAX_DOCUMENT_BYTES = 1_048_576;

// Task 14의 동등성 테스트가 이 배열을 그대로 임포트해 검사하므로 export 해서 구성이 갈라지지 않게 한다.
export const ALL_FRAGMENTS: readonly QueryFragment[] = [
  ...recordFragments, ...accessFragments, ...stringFragments,
  ...configFragments, ...tableFragments, ...templateFragments,
];

export class TreeSitterPhpSyntax implements PhpSyntax {
  private constructor(
    private readonly runtime: PhpRuntime,
    private readonly fragments: FragmentSet,
    private readonly query: CompiledQuery,
  ) {}

  static async create(runtimeDir?: string): Promise<TreeSitterPhpSyntax> {
    const runtime = await PhpRuntime.create(runtimeDir);
    const fragments = FragmentSet.of(ALL_FRAGMENTS);
    return new TreeSitterPhpSyntax(runtime, fragments, runtime.compile(fragments.source));
  }

  facts(text: string, need?: ReadonlySet<FactKind>): DocumentFacts {
    if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) return emptyFacts();
    const doc = this.runtime.parse(text);
    if (!doc) return emptyFacts();
    const facts = emptyFacts();
    // collect() 도중 예외가 나도(예: 캡처 누락) tree는 반드시 해제한다 — WASM 트리는 GC 대상이 아니다.
    // 파싱 실패와 달리 이 예외는 삼키지 않고 그대로 던진다: 파싱 실패는 (여기 전제한 대로) 흔한
    // 입력 문제라 침묵 처리하지만, collect() 예외는 조각의 캡처 이름 오타 같은 버그 신호라 숨기면 안 된다.
    try {
      const scopes = ScopeTable.of(doc.scopeRanges(), doc.endIndex);
      this.fragments.collect(doc.run(this.query, scopes), {
        add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); },
      }, need);
    } finally {
      doc.dispose();
    }
    // 통합 쿼리는 매치를 문서 순서로 내놓아 조각별로 먼저 도는 쪽이 없다. 옛 구현이 "먼저 도는
    // 쿼리가 이긴다"로 얻던 두 정규화를 여기서 명시적으로 다시 만든다.
    facts.assignments = preferTableArg(facts.assignments);
    facts.foreachBindings = uniqueByIndex(facts.foreachBindings);
    return facts;
  }

  classMembers(text: string, className: string): RawClassMember[] {
    const doc = this.runtime.parse(text);
    if (!doc) return [];
    try {
      const body = doc.classBody(className);
      return body ? readClassMembers(body) : [];
    } finally {
      doc.dispose();
    }
  }
}

// assignWithTable·assignWithoutTable 둘 다 걸리는 자리(예: $DB->get_record)는 같은 index에
// 두 항목을 만든다. tableArg가 있는 쪽을 남긴다 — 먼저 나온 순서와 무관하다.
function preferTableArg(assignments: RecordAssignment[]): RecordAssignment[] {
  const best = new Map<number, RecordAssignment>();
  for (const a of assignments) {
    const kept = best.get(a.index);
    if (!kept || (kept.tableArg === null && a.tableArg !== null)) best.set(a.index, a);
  }
  return [...best.values()];
}

// foreach 네 조각은 노드 형태가 서로 달라 원래 겹치지 않지만, 방어적으로 item 위치 기준
// 중복을 제거해둔다.
function uniqueByIndex<T extends { index: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  return items.filter(item => (seen.has(item.index) ? false : (seen.add(item.index), true)));
}
