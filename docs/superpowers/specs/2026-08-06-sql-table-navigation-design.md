# CSMS Code — SQL 테이블 참조 이동 설계

- **작성일**: 2026-08-06
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **요청**: "sql 구문의 table도 찾아서 install.xml로 갈 필요가 있어요"
- **범위 확정**: 정의 이동 + 하이라이트까지 (hover·`$DB` 인자 리터럴은 사용자 판단으로 제외)

---

## 1. 배경

Moodle은 SQL 안에서 테이블을 `{tablename}`으로 적고 실행 시 `$CFG->prefix`를 붙인다. 지금 확장은 `$DB->get_record()` **결과 변수의 컬럼**은 알지만, SQL 문자열 안의 테이블 이름 자체는 아무 의미가 없는 텍스트다. `{local_ubattend_config}`에서 그 테이블이 어떤 컬럼을 가졌는지 보려면 install.xml을 손으로 찾아야 한다.

### 측정이 결정한 것 (hlulxp `local`·`theme`·`blocks`·`mod`, PHP 파일 기준)

| 항목 | 값 | 판정 |
|---|---|---|
| 문자열 안 `{단어}` 총 참조 | 7,585 (파일 680개) | — |
| install.xml의 테이블로 해석됨 | **4,384 (57.8%)** — 고유 테이블 335개 | 이것만 반응한다 |
| 해석 안 됨 | 3,201 (고유 이름 206개) | **침묵한다** |
| 인용 방식 | 단일 69.1% / 이중 30.8% / heredoc 0.1% / nowdoc 0% | 넷 다 지원 |

**진단은 비목표다.** 해석되지 않는 3,201개는 SQL이 아니다 — 정규식 수량자(`{4}`·`{12}`·`{2}`), AWS SDK 플레이스홀더(`{Bucket}`·`{FunctionName}`·`{IdentityPoolId}`), 치환 자리표시자(`{break}` 480회·`{courseid}` 41회). 경고를 붙이면 이 저장소 하나에서만 오탐 3,201건이다. 해석 성공에만 반응하는 기존 침묵 원칙을 그대로 따른다.

**SQL 키워드 문맥 필터도 넣지 않는다.** 해석된 4,384개 중 같은 문자열에 SELECT/FROM/JOIN/UPDATE/WHERE가 없는 것은 280개(6.4%)인데, 표본을 보면 대부분 진짜 SQL이다 — `ALTER TABLE {local_ubion_lang} ADD COLUMN`, `, {groups_members} gm`처럼 조각을 이어붙여 SQL을 만드는 코드. 필터는 도움보다 손해다. 대가는 `index.php?id={course}` 같은 비SQL 문자열이 드물게 링크 색상을 받는 것이고, 이는 F12에서 무해하다.

### grammar 확인

PHP grammar에서 문자열 내용 노드는 다음과 같다.

| 인용 방식 | 노드 경로 |
|---|---|
| `'…'` | `string` → `string_content` |
| `"…"` | `encapsed_string` → `string_content` (보간마다 쪼개짐) |
| `<<<SQL` | `heredoc` → `heredoc_body` → `string_content` |
| `<<<'SQL'` | `nowdoc` → `nowdoc_body` → `nowdoc_string` |

즉 **`string_content`와 `nowdoc_string` 두 타입만 잡으면 네 방식이 모두 덮인다.** `{$var}` 보간은 별도 노드로 쪼개지고 `$`가 있어 `\{(\w+)\}`에 걸리지 않는다.

`Table.location`이 이미 `<TABLE>` 선언 줄을 가리키므로 색인·파서는 손대지 않는다.

## 2. 목표

1. PHP 문자열 안의 `{table}`에서 F12 → 그 테이블의 install.xml `<TABLE>` 줄로 이동.
2. 해석되는 `{table}` 참조를 링크 색상으로 하이라이팅(설정으로 끌 수 있음).
3. 단일 인용·이중 인용·heredoc·nowdoc 모두 동작하고, 여러 줄 heredoc에서도 위치가 정확할 것.

### 비목표
- **진단**(위 근거), **hover**, **`$DB->get_records('user', …)` 메서드 인자 리터럴**, install.xml → 사용처 참조(Shift+F12), JS 안의 SQL, SQL 안의 컬럼 이름 인텔리전스.

## 3. 설계

### 3.1 팩트 추출 (`facts.ts` + `tree-sitter-php-syntax.ts`)

```ts
export interface TableRef {
  name: string;
  nameLine: number; nameColumn: number; nameIndex: number;
}
```
`DocumentFacts.tableRefs: TableRef[]`로 추가한다. `stringCalls`·`templateCalls`와 같이 **`scope` 필드를 두지 않는다** — `scopeContaining`이 `'scope' in x`로 스코프 보유 팩트를 가리므로 필드를 넣으면 스코프 계산에 끼어든다.

쿼리는 패턴 두 개를 한 쿼리에 둔다.
```
(string_content) @s
(nowdoc_string) @s
```
각 노드 텍스트에 `/\{(\w+)\}/g`를 돌리고, 이름 시작 위치를 계산한다.
- `nameIndex` = `node.startIndex + m.index + 1` (`{` 다음)
- `nameLine`/`nameColumn`: 노드 텍스트에서 매치 앞의 줄바꿈 수를 세어 구한다. 줄바꿈이 없으면 `node.startPosition.row` / `column + m.index + 1`, 있으면 `row + n` / `m.index + 1 - (마지막 줄바꿈 위치 + 1)`. 노드마다 텍스트를 한 번만 훑는 증분 계산으로 한다(매치마다 역방향 스캔 금지 — JS 스캐너와 같은 이유).

### 3.2 유즈케이스

기존 템플릿 유즈케이스와 형태를 맞춘다.

```ts
// src/application/resolve-table-definition.ts
export class ResolveTableDefinition {
  constructor(private syntax: PhpSyntax, private tables: TableRepository) {}
  run(text: string, atIndex: number): DefinitionResult[]
}
```
`atIndex`가 어떤 `TableRef` 이름 범위(`nameIndex ≤ atIndex ≤ nameIndex + name.length`) 안이면 `tables.getTable(name)?.location`을 담아 반환하고, 색인에 없으면 빈 배열.

```ts
// src/application/list-resolved-table-refs.ts
export class ListResolvedTableRefs {
  constructor(private syntax: PhpSyntax, private tables: TableRepository) {}
  run(text: string): RangeItem[]   // 색인에 있는 것만, length = name.length
}
```

### 3.3 프리젠테이션

- `src/presentation/providers/table-definition-provider.ts` — `TemplateDefinitionProvider`와 같은 3줄 구조.
- `extension.ts`: php 셀렉터에 `registerDefinitionProvider` 추가, 하이라이트 소스에 `{ setting: 'tables.highlightResolved', languages: ['php'], run: t => listResolvedTable.run(t) }` 추가.
- 설정 `csmscode.tables.highlightResolved`(boolean, 기본 `true`) — 기존 `strings.`·`templates.` 명명과 맞춘다.

같은 언어에 정의 프로바이더가 여러 개 등록되지만 VS Code가 결과를 합치고, 각 프로바이더는 자기 팩트에 안 걸리면 빈 배열을 준다.

### 3.4 부수 변경 — `detectInSubfolders` 기본값

`csmscode.detectInSubfolders` 기본값을 `[]` → `["moodle"]`로 바꾼다.

근거: 로컬 코드베이스 68개 중 **58개가 Moodle을 `moodle/` 하위에 둔 레이아웃**이고 루트 직접은 10개뿐이다. 기본값이 `[]`이면 그 58개에서 확장이 아무것도 하지 않는다. `isMoodleRoot()`가 `version.php`와 `lib/db/install.xml`을 함께 확인하므로 이름만 `moodle`인 디렉터리를 잘못 잡을 위험은 없다.

## 4. 테스트 전략

- **팩트**: 단일 인용·이중 인용·heredoc·nowdoc 각각에서 `{table}` 추출. 한 문자열에 여러 참조. 여러 줄 heredoc의 두 번째 줄 참조에서 `nameLine`·`nameColumn` 정확성. `{$var}` 보간·`{4}` 같은 숫자는 이름으로 잡히지 않음(숫자는 `\w`에 걸리므로 **추출은 되고 해석에서 걸러진다** — 이 동작을 테스트로 고정).
- **유즈케이스**: 색인에 있는 이름 → 위치 반환, 없는 이름 → 빈 배열, 이름 범위 밖 offset → 빈 배열, 이름 끝 경계(마지막 문자) 포함.
- **하이라이트**: 해석되는 참조만 범위에 포함되고 length가 이름 길이와 같음.
- **루트 탐색**: 기본값이 `["moodle"]`일 때 하위 폴더 루트를 찾고, 하위에 `version.php`만 있고 `lib/db/install.xml`이 없으면 찾지 않음.
- **회귀**: 기존 210건 녹색.

## 5. 성공 기준

- `{course}`·`{local_ubattend_config}` 어느 인용 방식에서든 F12가 install.xml `<TABLE>` 줄로 이동한다.
- 해석 안 되는 `{4}`·`{Bucket}`은 이동도 하이라이트도 없다(진단도 없다).
- 기존 210건 무회귀 + 신규 테스트, lint/compile 통과.
- 사이클 병합과 함께 버전 0.5.0 + CHANGELOG 항목.
