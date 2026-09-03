# 파서·색인 계층 재작성 설계

CSMS Code의 PHP 문법 계층과 워크스페이스 색인 계층을 계약을 고정한 채 구현만 전면 교체한다.
목표는 **편집 중 지연**과 **창당 상주 메모리**이며, 둘 다 실측 기준선이 있다.

---

## 1. 기준선

모든 수치는 실제 Moodle 체크아웃(`csms45`, PHP 24,715개 / 193MB, mustache 3,009개, AMD JS 1,169개)에서
측정했다. 재현 스크립트는 §7에 적는다.

### 1.1 문법 계층 — `facts()` 한 번의 비용

14KB 플러그인 파일(`local/manager/lib.php`, 노드 2,561개) 기준 **17.0 ms**.

| 단계 | 비용 | 비중 |
|---|---|---|
| 파싱 | 2.07 ms | 12% |
| 쿼리 27개 | 11.51 ms | 68% |
| 추출 + phpdoc 워크 | 3.40 ms | 20% |

쿼리 27개를 각각 루트에 돌리므로 트리를 27번 훑는다. 매치가 0건인 쿼리도 개당 0.4~0.8ms를 쓴다.
`extractPhpdocVars`의 전체 노드 JS 재귀는 1.15ms이고, 같은 결과를 정규식으로 얻으면 0.014ms다.

파일 크기별 파싱·쿼리 비용:

| 파일 | 개별 쿼리 | 파싱 |
|---|---|---|
| 14KB | 12.09 ms | 1.81 ms |
| 61KB | 95.10 ms | 11.62 ms |
| 81KB | 98.45 ms | 13.15 ms |
| 363KB | 422.27 ms | 62.17 ms |

### 1.2 문법 계층 — 파싱 실패

실제 파일 3,089개 샘플에서 12건(0.39%)이 `parse()`에서 예외를 던진다. 그 파일은 인텔리전스가 전부 침묵한다.
원인은 이중 인용 문자열의 **16진 이스케이프 전부**다 — `"\x00"`만이 아니라 `"\x41"`도 던진다.
ERROR 노드를 포함한 파일은 0건이므로 문법 자체는 실제 Moodle 코드를 정확히 읽는다.

현재 조합은 `web-tree-sitter@0.20.8` + `tree-sitter-wasms@0.1.13`(문법 ABI 13~14)이다.

### 1.3 색인 계층

| 항목 | 값 |
|---|---|
| 콜드 빌드 | 24,890 파일 / 28.7 s (I/O 바운드, 웜 5.4 s) |
| 강제 GC 후 보유 메모리 | **130 MB** |
| 항목 수 | 89,897 (문자열 48,803 · 테이블 33,123 · 템플릿 5,228 · 설정 2,139 · AMD 604) |
| 스냅샷 | JSON 4.67 MB / gzip 1.07 MB |
| `revalidate` (변경 없음) | 1.7 s |
| `loadSnapshot` | 1.8 s |

활성화 경로(웜 캐시):

| 단계 | 시간 |
|---|---|
| `pluginTypeDirsAsync` | 2.52 s |
| install.xml 색인 | 0.78 s |
| lang 색인 | 3.15 s |
| 템플릿 색인 | 0.58 s |
| AMD 색인 | 0.31 s |
| **합계** | **7.34 s** (보유 19.2 MB) |

창당 상주 합계는 약 150 MB이고, 사용자가 프로젝트를 5개 열면 확장 호스트가 창마다 따로 있으므로
**약 650 MB**가 상주한다.

### 1.4 메모리의 근본 원인

정규식 캡처는 V8에서 sliced string이 되어 **부모 문자열 전체를 붙잡는다.** 격리 실험에서
8MB 텍스트 5개를 스캔해 185자만 보관했을 때 40.0 MB가 남았고, 캡처를 `Buffer` 왕복으로 평탄화하면
0.0 MB가 남았다. Map 인터닝만으로는 32.0 MB가 남는다 — 풀에 저장한 값이 여전히 sliced string이기 때문이다.

`php-usage-index`의 캡처 8곳에 평탄화를 넣자 보유 메모리가 **130 MB → 42 MB**로 줄었고
빌드 시간은 5.4s → 5.3s로 변하지 않았다.

같은 실험에서 짧은 캡처(12자 미만)만 보관해도 8.0 MB가 남았다. 모듈 스코프 `RegExp` 객체가
마지막으로 스캔한 대상 문자열을 계속 붙잡기 때문이다. 현재 코드에는 모듈 스코프 정규식이 7개 있다.

잔여 42 MB의 구성(별도 측정):

| 구조 | 현재 형태 | 수치 형태 |
|---|---|---|
| 항목 90,000개 | 객체 11.8 MB | `Int32Array`×4 = 1.4 MB |
| 파일 도장 26,120개 | `Map<절대경로, FileStamp>` 2.7 MB | 패킹 문자열 + 타입 배열 1.9 MB |

또한 `scanMustache`·`scanJsCalls`는 같은 캡처 누수 경로인데 위 42 MB 측정에 포함되지 않았다.

### 1.5 통합 쿼리

쿼리 조각을 하나의 쿼리로 합쳐 컴파일하고 매치의 패턴 인덱스로 분기하면 쿼리 단계가 16배 빨라진다.
패턴별 매치 수는 개별 컴파일과 완전히 일치한다.

| 파일 | 개별 26개 | 통합 1개 | 배수 | 패턴별 불일치 |
|---|---|---|---|---|
| 14KB | 12.09 ms | 0.75 ms | 16.0× | 0건 (273 vs 273) |
| 61KB | 95.10 ms | 6.02 ms | 15.8× | 0건 (1,662 vs 1,662) |
| 363KB | 422.27 ms | 25.69 ms | 16.4× | 0건 (5,497 vs 5,497) |
| 81KB | 98.45 ms | 4.76 ms | 20.7× | 0건 (2,130 vs 2,130) |

**이 이득은 현재 런타임에서도 얻는다.** 0.20.8에서 같은 측정이 16.2× / 14.7× / 17.0×이고,
매치의 패턴 인덱스 필드 이름만 다르다 — 0.20.8은 `pattern`, 0.27.0은 `patternIndex`.
따라서 통합 쿼리와 런타임 업그레이드는 서로 독립적인 결정이다.

### 1.6 런타임 업그레이드 가능성

`web-tree-sitter@0.27.0` + `tree-sitter-php@0.24.2`(사전 빌드 wasm, ABI 15) 조합에서:

- 16진 이스케이프가 정상 파싱된다
- enum · readonly 프로퍼티 · named arguments · first-class callable syntax가 정상 파싱된다
- 현재 런타임 0.20.8은 ABI 15를 거부한다(`Compatibility range 13 through 14`) — 문법 교체는 런타임 교체를 요구한다
- `#any-of?` 술어가 컴파일·동작하고 비용 증가가 없다
- esbuild CJS 번들에서 동작한다. `import.meta.url`이 `undefined`가 되어 emscripten의 wasm 탐색이
  실패하므로 배너가 필요하다:
  `--banner:js='const __ts_import_meta_url = require("url").pathToFileURL(__filename).href;'`
  와 `--define:import.meta.url=__ts_import_meta_url`
- 현재 쿼리 27개 중 `Q_PROPERTY_LITERAL` 하나가 컴파일에 실패한다(`Bad node name 'property_initializer'`)

---

## 2. 목표와 비목표

### 목표

1. `facts()` 17.0 ms → **4~5 ms** (14KB 파일 기준)
2. 사용처 색인 보유 메모리 130 MB → **25 MB 이하**, 창 5개 기준 650 MB → 125 MB 이하
3. 16진 이스케이프가 든 파일에서 인텔리전스가 살아 있을 것
4. 활성화 7.34 s → **5 s 이하** — 트리 순회 5종을 1종으로
5. 유지보수성: tree-sitter 타입이 한 디렉터리 밖으로 나가지 않고, 파일 하나가 한 가지 일만 한다

### 비목표

- **기능 동작 변경.** 완성·정의·hover·참조·CodeLens·하이라이트·진단의 결과는 현행과 같아야 한다.
  16진 이스케이프 파일이 침묵에서 벗어나는 것만 관찰 가능한 변화다.
- **콜드 스캔 단축.** 28.7 s는 I/O 바운드이고(웜 5.4 s) 재작성으로 크게 줄지 않는다.
  줄어드는 것은 메모리와 `loadSnapshot` 1.8 s다.
- 새 인텔리전스 대상, 새 설정, PHP 타입 추론 확장.

---

## 3. 계약 경계

다음은 재작성 내내 고정한다. 26개 유스케이스와 20개 이상의 단위 테스트가 이 경계에 붙어 있으므로,
각 단계가 끝날 때마다 기존 테스트가 그대로 회귀 게이트가 된다.

- `domain/code-analysis/ports/php-syntax.ts` — `PhpSyntax`, `RawClassMember`
- `domain/code-analysis/facts.ts` — `DocumentFacts`와 그 구성 타입
- `domain/lang-model/ports/`, `domain/template-model/ports/`, `domain/amd-model/ports/`,
  `domain/moodle-model/ports/`의 리포지토리 포트 전부

`DocumentFacts`에 대한 유일한 변경은 **하위호환 확장**이다. `PhpSyntax.facts(text, need?)`에
선택 인자를 더하고 기본값을 전체로 둔다. 기존 호출처는 수정하지 않는다.

교체 대상은 `infrastructure/tree-sitter/`, `infrastructure/caching/`, `infrastructure/usage/`,
그리고 `infrastructure/workspace/`의 열거 함수들이다.

**결합도 규칙**: `Parser.SyntaxNode` 등 tree-sitter 타입은 `infrastructure/php/` 밖으로 나가지 않는다.
현재는 617줄 한 파일에 쿼리 문자열·추출 로직·클래스 멤버 파싱이 뭉쳐 있고 tree-sitter 타입이
추출 코드 전반에 퍼져 있다.

---

## 4. 1단계 — 문법 계층

### 4.1 구성

```
src/infrastructure/php/
  query-fragment.ts       조각 하나의 타입과 최상위 패턴 수 검사
  fragments/
    record.ts             대입·foreach·dataArg·plainAssign·프로퍼티 접근·메서드 호출
    strings.ts            get_string 계열 리터럴·동적 컴포넌트·리터럴 출처
    config.ts             get_config·set_config 리터럴·동적
    tables.ts             문자열 본문·$DB 첫 인자
    templates.ts          render_from_template·js_call_amd
  fragment-set.ts         조각 목록 → 통합 소스, 패턴 인덱스 → 조각 분기
  scope-table.ts          스코프 구간 수집과 인덱스 조회
  phpdoc-vars.ts          정규식 @var
  class-members.ts        classMembers 구현
  tree-sitter-runtime.ts  Parser 생성·wasm 위치·파싱 실패 격리·패턴 인덱스 필드 흡수
  php-syntax.ts           조립
  facts-cache.ts          LRU
```

### 4.2 조각

```ts
export interface QueryFragment {
  readonly produces: FactKind;
  readonly pattern: string;
  collect(at: Captures, into: FactSink): void;
}
```

`Captures`는 `text(name)` · `index(name)` · `position(name)`만 노출하고 **지연 평가**한다.
현재 `Q_TEMPLATE_CALL`이 메서드 이름을 먼저 보고 관심 없는 호출에서 빠져나가는 것처럼,
캡처를 실제로 읽기 전에 탈출하는 경로가 그대로 유지된다.

`FactSink`는 팩트 종류별 push 메서드를 갖는다. 조각은 tree-sitter를 모르므로 파서 없이 단위 테스트할 수 있다.

### 4.3 단일 패턴 불변식

조각은 최상위 패턴을 **정확히 하나만** 갖는다. `fragment-set.ts`가 생성 시점에 각 조각의 최상위 패턴 수를
세어 1이 아니면 예외를 던진다. 그러면 매치의 패턴 인덱스가 조각 배열 인덱스와 항상 일치한다.

현재 `Q_STRING_BODY`는 `(string_content) @s`와 `(nowdoc_string) @s` 두 패턴이므로 조각 두 개로 쪼갠다.
이 조각이 선언 순서상 마지막이라 지금은 우연히 어긋나지 않을 뿐이고, 조각 순서가 바뀌면 그 뒤 조각이
전부 한 칸씩 밀려 **조용히 오분배**된다 — 문자열 본문이 상수 리터럴로 처리되는 식이다.
작은 픽스처로는 잡히지 않으므로 불변식과 §7.1 테스트 둘 다 필요하다.

### 4.4 스코프

캡처마다 부모를 거슬러 오르는 대신, 스코프 노드(`function_definition` · `method_declaration` ·
`anonymous_function_creation_expression` · `arrow_function`)를 한 번 모아 시작 오프셋 순으로 정렬한
구간 테이블을 만들고, 인덱스로 **가장 안쪽 포함 구간**을 조회한다. 스코프는 항상 올바르게 중첩되므로
스택으로 구성할 수 있다. 어느 구간에도 들지 않으면 문서 전체가 스코프다(현행과 같다).

### 4.5 phpdoc

전체 노드 재귀 워크를 정규식으로 대체한다(1.15 ms → 0.014 ms 실측). 스코프는 §4.4 테이블로 조회한다.
현행 동작은 주석 노드 안에서만 `@var`를 찾는 것인데, 정규식은 주석 밖의 `@var`도 잡을 수 있다.
문자열 리터럴 안에 `@var Type $x` 형태가 들어 있는 경우가 그렇다. 이는 팩트 diff(§7.2)에서
확인하고, 차이가 실제로 나오면 주석 노드 범위 목록으로 걸러낸다.

### 4.6 선택적 추출

`facts(text, need?: ReadonlySet<FactKind>)`. `need`에 없는 팩트 종류를 산출하는 조각은 `collect`를
건너뛴다. 통합 쿼리는 하나 그대로이므로 추가 컴파일이 없다. 기본값이 전체이므로 26개 호출처는 무수정이다.

통합 쿼리 적용 후 추출이 비용의 절반 이상이 되므로(파싱 1.9 + 쿼리 0.8 + 추출 ~3.4), 뜨거운 경로부터
좁혀 간다. 캐시는 `need` 조합까지 키에 포함해야 부분 팩트가 전체 팩트로 오인되지 않는다.

### 4.7 파일 크기 상한

1 MB를 넘는 파일은 팩트 없음으로 떨어뜨린다. 현행 침묵 원칙과 같은 처리다.
363KB 파일이 파싱 62 ms + 통합 쿼리 26 ms이므로 상한 근처에서도 편집을 막지 않는다.

### 4.8 1b — 런타임·문법 업그레이드 (별도 커밋)

`web-tree-sitter` 0.20.8 → 0.27.0, `tree-sitter-wasms@0.1.13` → `tree-sitter-php@0.24.2`.

- `esbuild.mjs`: wasm 복사 경로 변경(`web-tree-sitter.wasm`, `tree-sitter-php.wasm`) + §1.6의 배너·define
- `tree-sitter-runtime.ts`가 패턴 인덱스 필드 이름 차이를 흡수한다
- `Q_PROPERTY_LITERAL`에 해당하는 조각을 신 문법의 노드 이름으로 다시 쓴다
- **승인 조건**: §7.2 팩트 diff에서 나온 차이를 전부 분류하고 의도한 개선임을 확인할 것

되돌리기 쉽도록 1단계 본체와 분리한다.

---

## 5. 2단계 — 색인 계층

### 5.1 구성

```
src/infrastructure/usage/
  string-pool.ts     id(s): StringId  ·  text(id): string
  extractors/
    php.ts  js.ts  mustache.ts
  usage-store.ts     항목 보관·조회·파일 단위 교체
  workspace-scan.ts  열거·읽기·도장
  snapshot.ts        디스크 표현
```

### 5.2 저장 구조가 문자열을 받지 않는다

추출기는 문자열이 아니라 `StringId`를 반환한다. `UsageStore`가 다루는 값은 전부 수치
(`StringId` · `FileId` · line · column)이므로 sliced string이 타입상 살아남을 수 없다.
`string-pool.ts`는 풀에 넣을 때 평탄화한 사본만 저장한다 — 인터닝만으로는 부족하다는 것이 §1.4에서 측정됐다.

도메인 타입 `SourceLocation`은 조회 경계에서 풀로부터 되살린다. 한 번 조회가 돌려주는 위치는 많아야
수백 건이라 비용이 없다.

부수 효과로 문자열 풀이 그대로 스냅샷 사전이 되고, 항목이 수치이므로 저장 레이아웃
(객체 배열 → 타입 배열)이 `usage-store.ts` 내부 결정으로 내려간다.

### 5.3 함께 고치는 것

- 모듈 스코프 `RegExp` 7개 — 정규식 객체가 마지막 스캔 대상 문자열을 계속 붙잡는다. 스캐너 인스턴스가
  소유하게 하고, 파일 스캔이 끝나면 대상 참조를 끊는다.
- `removeEntry`의 `arr.indexOf(e.loc)` — 파일 교체마다 게시 배열을 선형 탐색하므로 항목이 많은 파일에서
  제곱이 된다. 파일별 항목 목록에서 대상 id를 얻어 해당 게시 목록만 손본다.
- `scanMustache` · `scanJsCalls`도 같은 풀을 지나게 한다. 지금은 누수 경로가 셋인데
  §1.4의 42 MB 측정에는 PHP 한 경로만 반영돼 있다.

### 5.4 목표

130 MB → **25 MB 이하**. 실측된 하한은 항목 1.4 MB + 도장 1.9 MB이지만 게시 목록·문자열 풀·Map 오버헤드가
남으므로 15 MB는 낙관치로 두고 단정하지 않는다. §7.3 게이트가 실제 수치를 고정한다.

---

## 6. 3단계 — 열거·워처·스냅샷

### 6.1 순회 통합

지금 트리 순회가 5종이다: install.xml · lang · templates · amd · usage. 앞의 4종은 플러그인 디렉터리를
겨냥한 순회지만 디렉터리마다 `existsSync`와 `realpathSync`를 부른다. 한 번 순회하며 각 파일을 한 번만
분류하고 결과를 다섯 소비자가 나눠 쓴다. 활성화 7.34 s가 여기서 줄고, usage 스캔이 같은 결과를 재사용한다.

심볼릭 링크 순환 가드와 컴포넌트 귀속 규칙은 현행 함수를 그대로 옮긴다. AMD 순회의 순환 가드가
루트마다 별개여야 한다는 제약(같은 디렉터리를 두 컴포넌트가 가리킬 때)도 유지한다.

### 6.2 워처

6종 감시 패턴이 각자 갱신 경로를 갖고 있다. 경로 분류 단일 함수 + 대상 색인 위임으로 바꾸고,
그 분류 함수를 §6.1 순회가 함께 쓴다 — 콜드 스캔과 저장 증분의 제외·귀속 규칙이 갈라질 수 없게 한다.

### 6.3 스냅샷

문자열 풀이 사전이므로 스냅샷은 사전 + 수치 배열이 된다. `loadSnapshot` 1.8 s와 gzip 1.07 MB가
함께 줄어든다. 포맷 버전을 올리면 기존 캐시는 현행 검증 로직(`isSnapshotUsable`)이 버린다.

---

## 7. 검증

### 7.1 통합 쿼리 동등성 (1단계 게이트)

실제 Moodle 파일 코퍼스에서 조각을 개별 컴파일했을 때와 통합 쿼리의 **패턴별 매치 수**가 전부 일치하는지
단정한다. 총합만 비교하면 오분배를 놓친다 — 총합은 같고 귀속만 어긋나는 것이 정확히 이 실패 모드다.

### 7.2 팩트 diff (1b 게이트)

수백 개 실제 파일에서 옛 `facts()`와 새 `facts()`의 `DocumentFacts`를 비교하고 차이를 전부 분류한다.
차이는 문법 회귀이거나 의도한 개선이며, 각각을 판정하기 전에는 "동작 동일, 더 빠름"이 검증되지 않은 주장이다.

### 7.3 메모리 회귀 게이트 (2단계 게이트)

색인 빌드 후 강제 GC를 돌리고 보유량 상한을 단정한다. 이 재작성의 핵심 성과가 메모리이므로 테스트가 지킨다.
`--expose-gc` 없이 측정하면 미수집 가비지가 섞여 277 MB로 보인다 — 실제 보유량은 130 MB다.

### 7.4 기존 테스트

단위 20여 개와 xvfb 통합 테스트가 각 단계 뒤에 그대로 통과해야 한다. 계약을 고정한 이유가 이것이다.

---

## 8. 위험

| 위험 | 방어 |
|---|---|
| 패턴 인덱스 오분배 — 조용한 전면 오류 | 조각당 최상위 패턴 1개 불변식(§4.3) + 동등성 테스트(§7.1) |
| 신 문법의 노드 이름·트리 모양 변화 | 팩트 diff(§7.2)가 1b의 승인 조건. `property_initializer`가 이미 한 건 |
| 순회 통합이 심볼릭 링크·컴포넌트 귀속을 건드림 | 현행 규칙을 함수째 옮기고 기존 픽스처 테스트 유지 |
| 선택적 추출의 캐시 오염 | 캐시 키에 `need` 조합 포함(§4.6) |
| 콜드 스캔이 빨라질 것이라는 기대 | I/O 바운드라 거의 안 줄어든다. §2 비목표에 명시 |

---

## 9. 재현

기준선은 아래 방법으로 다시 잴 수 있다. §7.1과 §7.3은 저장소 안 테스트로 들어간다.

| 측정 | 방법 |
|---|---|
| `facts()` 분해 | 파싱·쿼리별·추출을 각각 20회 반복 평균 |
| 파싱 실패율 | 3,089개 균등 샘플에서 `parse()` 예외 계수 |
| 통합 쿼리 동등성 | 조각 개별 컴파일 vs 통합 쿼리의 패턴별 매치 수 |
| 색인 보유 메모리 | `node --expose-gc`, 빌드 전후로 GC 4회 후 `heapUsed` 차 |
| 활성화 시간 | `pluginTypeDirsAsync` + 선행 색인 4개의 `buildFromRootAsync` |

`hasError`는 `web-tree-sitter@0.20.8`에서 **메서드**다. 프로퍼티로 읽으면 항상 참이 되어
ERROR 노드 비율이 99.6%로 잘못 나온다. 실제 값은 0%다.
