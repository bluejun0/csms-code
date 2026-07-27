# CSMS Code — VSCode 확장 프로그램 설계

- **작성일**: 2026-07-23
- **작성자**: Claude (jun0@bluesoft.co.kr 요청)
- **상태**: 설계 확정 (2026-07-27 사용자 승인) — 구현 계획 작성 단계
- **프로젝트 경로**: `/home/user/workspace/vscode-csms-code`

---

## 1. 배경과 목표

### 배경
- [mdlcode](https://mdlcode.dev/)(LMSCloud)는 Moodle 플러그인 개발용 VSCode/PHPStorm 확장으로,
  언어 문자열·DB 테이블·capability·템플릿·웹서비스 등 **Moodle 고유 요소**에 대한
  이동(go-to-definition)/자동완성/hover/진단(diagnostics)/코드 생성 마법사를 제공한다.
- 우리 코드베이스(`~/workspace/*lxp` 6개 + `*lms` 계열)는 **Moodle 4.5.8 (branch 405)** 기반이며,
  `local/` 아래에 `ub*`, `coursemos`, `agreement`, `talk`, `manager` 등 **CSMS 커스텀 플러그인**이 대거 존재한다.
- 커스텀 플러그인 중 **19개가 자체 `db/install.xml`**(고유 DB 테이블)을 가진다.

### 핵심 페인포인트 — "stdClass로만 되어있는 것"
Moodle/CSMS 코드는 DB 레코드를 대부분 `stdClass`로 다룬다. 실측(hlulxp 기준):

| 패턴 | 건수(local 커스텀만) |
|---|---|
| `$DB->get_record_sql(` | 203 |
| `$DB->update_record(` | 201 |
| `$DB->insert_record(` | 166 |
| `$DB->get_record(` | 135 |
| `$DB->get_records(` | 30 |
| 수동 `@var/@param/@return stdClass` 주석 | 419 |

`$user = $DB->get_record('user', ...)` 의 결과는 `stdClass`라 **일반 PHP 언어 서버가 `$user->` 프로퍼티를 자동완성하지 못한다.**
개발자가 install.xml을 직접 열어 컬럼명을 확인하거나 419건처럼 수동 주석을 단다.

### 목표
1. **mdlcode의 대부분 기능**을 우리 CSMS/LXP 코드베이스에서 동작하도록 재현한다.
2. 그 위에 **차별화 기능 = stdClass DB 레코드 인텔리전스**를 얹는다:
   `$DB->get_record('local_ubattend_config', ...)` 결과에 대해 컬럼 자동완성·이동·hover·오타 진단을 제공한다.
3. **core + 커스텀 플러그인 테이블을 동등하게** 색인한다. 커스텀 테이블 커버리지가 "우리 CSMS용"의 본질이다.
4. install.xml `<FIELD COMMENT="...">`와 lang 값이 **한국어**라는 점을 적극 활용한다 —
   hover에 한국어 컬럼 설명/문자열을 띄우는 것은 이 팀에 특히 가치가 높다.

### 비목표(YAGNI)
- PHPStorm 지원(디렉터리명 `vscode-csms-code`, PHPStorm 요구 없음 → 제외).
- 완전한 PHP 타입 추론/전역 데이터플로우.
- Moodle 코어 자체 수정, 린터/포매터 대체.

---

## 2. 확정된 기술 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 대상 IDE | **VSCode 네이티브 확장 (TypeScript)** | 타깃 디렉터리가 `vscode-csms-code`, PHPStorm 비목표. LSP는 PHPStorm이 스코프에 들어올 때만. |
| PHP 파싱 | **tree-sitter-php (WASM, in-process)** — `web-tree-sitter@0.20.8` + `tree-sitter-wasms@0.1.13`(php grammar 0.22) 핀 | 스파이크로 검증(2026-07-27): WASM이 Node/확장 호스트에서 in-process 로드·파싱 성공 → 네이티브 바인딩 불필요. glayzzle는 대안. |
| 추론 범위 | **로컬 데이터플로우만** (현재 함수 스코프 내 `$var`의 가장 가까운 선행 대입) | 이 경계가 "출시 가능"을 만든다. 크로스 함수/리턴값 추론은 제외. |
| 색인 시점 | **1회 전체 색인 + 파일 워처 증분 갱신** | `lib/db/install.xml` 하나가 391KB. 키 입력마다 재파싱 금지. |
| 워크스페이스 | **런타임에 열린 트리에서 Moodle 루트·컴포넌트 맵 자동 발견** | hlulxp 하드코딩 금지. 6개 lxp + 다수 lms 어디서나 동작해야 함. |
| 코드 구조 | **DDD (Domain-Driven Design) + Hexagonal(Ports & Adapters)** | Moodle 도메인 지식과 VSCode/파서 기술을 분리. 차별화 로직(타입 추론)을 순수 도메인으로 두어 테스트·재사용 용이. |

> **DDD는 실용적으로 적용한다.** Onion 레이어 + 포트/어댑터 + 도메인 순수성(도메인에 `vscode`/`fs`/`tree-sitter` import 금지)까지만 채택하고,
> CQRS·이벤트소싱 같은 무거운 패턴은 필요 전까지 도입하지 않는다(YAGNI). 여전히 **하나의 확장·하나의 공유 색인**이다 — 레이어는 배포 단위가 아니라 논리 경계.

---

## 3. 아키텍처 — DDD / Hexagonal

mdlcode 기능들은 서로 다른 서브시스템이 아니라 **하나의 공유 색인을 읽는** 것이며, 이를 DDD 레이어로 표현한다.
의존성은 항상 **바깥 → 안**으로만 흐르고, 도메인은 아무것도 의존하지 않는다(인프라는 도메인이 정의한 포트를 구현 = 의존성 역전, DIP).

```
   바깥(기술/IO) ───────────────────────────────▶ 안(순수 도메인)
┌──────────────────────────────────────────────────────────────────┐
│ Presentation  (Driving Adapters, 유일하게 `vscode` import)          │
│  RecordColumnCompletion · Definition · Hover · Diagnostics · ...    │
│  └ Mapper: vscode 타입 ↔ Application DTO                            │
│      │ 호출                                                         │
│  ┌───▼────────────────────────────────────────────────────────┐   │
│  │ Application  (Use Cases — 도메인 오케스트레이션, IO 무의존)   │   │
│  │  CompleteRecordColumns · ResolveDefinition · DescribeSymbol  │   │
│  │  · ValidateRecordColumns · CompleteLangString · ...          │   │
│  │   ┌──────────────────────────────────────────────────────┐  │   │
│  │   │ Domain  (순수 — vscode/fs/tree-sitter import 금지)      │  │   │
│  │   │                                                        │  │   │
│  │   │  ┌── BC: Moodle Model ──┐   ┌── BC: Code Analysis ──┐  │  │   │
│  │   │  │ Component(root)       │   │ PhpUnit / Scope        │  │  │   │
│  │   │  │ Table⟨aggregate⟩+Field│◀──│ RecordBinding          │  │  │   │
│  │   │  │ LangString · Capability│   │ RecordTypeInference    │  │  │   │
│  │   │  │ ColumnValidator(svc)   │   │ (차별화 도메인 서비스) │  │  │   │
│  │   │  └───────────────────────┘   └────────────────────────┘  │  │   │
│  │   │  Repository Ports: Table/String/Capability/Component      │  │   │
│  │   │  Ports: PhpSyntax(AST 추상)                               │  │   │
│  │   └──────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│ Infrastructure  (Driven Adapters — 위 포트들을 구현, DIP)            │
│  XmldbTableRepo · PhpLangStringRepo · AccessPhpCapabilityRepo        │
│  · FsComponentRepo/MoodleRootResolver · TreeSitterPhpSyntax          │
│  · IndexStore(메모리 색인) + FileSystemWatcher(증분 재색인)          │
└──────────────────────────────────────────────────────────────────┘
        ▲ Composition Root = extension.ts (activate 시 DI 조립)
```

### 3.1 바운디드 컨텍스트(BC)
- **Moodle Model** *(core/supporting)* — Moodle 개념의 유비쿼터스 언어를 담는다.
  Aggregate: **`Table`**(root) + **`Field`**(VO). 그 외 **`LangString`**, **`Capability`**, **`Component`**(frankenstyle 루트).
  도메인 서비스 `ColumnValidator`(컬럼 존재/오타 검증)를 포함.
- **Code Analysis** *(core — 차별화)* — PHP를 해석해 **`RecordBinding`**(`$var` → `Table`)을 만든다.
  도메인 서비스 **`RecordTypeInference`**가 스코프 로컬 규칙(§4)으로 변수↔테이블을 결정.
  Moodle Model의 `TableRepository` 포트를 통해서만 스키마를 참조(컨텍스트 간 결합은 포트로만).
  AST는 도메인이 직접 알지 않고 **`PhpSyntax` 포트**로 추상화 → 파서 교체 가능(tree-sitter/glayzzle).

### 3.2 레이어별 책임
- **Domain** — 순수 모델·값객체·도메인 서비스·**포트(인터페이스)**. IO/프레임워크 의존 0. 단위 테스트 100%.
- **Application** — 유즈케이스별 서비스. 포트를 주입받아 도메인을 조율하고 **DTO**를 반환. `vscode` 무의존.
- **Infrastructure** — 포트 구현(어댑터). install.xml/lang/access.php 파싱, tree-sitter, 파일 워처, 메모리 색인(`IndexStore`).
- **Presentation** — VSCode 프로바이더(구동 어댑터). **여기만 `vscode`를 import**하고, Mapper로 도메인/DTO와 VSCode 타입을 상호 변환.
- **Composition Root** — `extension.ts`. 활성화 시 어댑터를 포트에 바인딩(수동 DI)하고 프로바이더를 등록.

### 3.3 포트 & 인덱스 데이터 형식 (실측 스키마 기반)
포트(도메인 정의) → 어댑터(인프라 구현):
- **`TableRepository`** ← `XmldbTableRepository`: `install.xml` 파싱.
  `<TABLE NAME="local_ubattend_config">` → `<FIELD NAME="courseid" TYPE="int" COMMENT="강좌 고유번호"/>`
  → `Table{ name, component, fields:[Field{name,type,comment,notnull,default,location}] }`. **COMMENT(한국어)를 hover에 사용.**
- **`StringRepository`** ← `PhpLangStringRepository`: `lang/en/<component>.php`의 `$string['key']='값';`
  → `LangString{ component, key, value, placeholders:['{$a}'], location }`.
- **`CapabilityRepository`** ← `AccessPhpCapabilityRepository`: `db/access.php`의 `$capabilities=array('local/imodule:xxx'=>...)`
  → `Capability{ name, location }`.
- **`ComponentRepository`** ← `FsComponentRepository`/`MoodleRootResolver`: 컴포넌트명 ↔ 물리 경로(코어 + 모든 플러그인).
  중첩 루트 대비 **`csmscode.detectInSubfolders`** 설정(팀이 이미 `dghuhani`/`cwulms`의 mdlcode에서 쓰는 개념).
- **`PhpSyntax`** ← `TreeSitterPhpSyntax`: 현재 문서 AST + 스코프 로컬 심볼/호출 인자 위치 제공.

> 어댑터들이 채운 결과는 **`IndexStore`**(메모리 색인)에 모여, 리포지토리 조회가 O(1)에 가깝게 동작한다.
> 액티베이션 1회 색인 + `FileSystemWatcher`로 변경 파일만 증분 갱신(§6).

---

## 4. 차별화 기능 — stdClass DB 레코드 인텔리전스 (핵심)

가장 가치 높고 가장 어려운 부분이라 구체적으로 못 박는다.

### 4.1 타입 소스 (변수 → 테이블 결정 방법)
1. **`get_record` / `get_record_sql`** — 첫 인자가 리터럴 테이블명일 때 `$var`를 그 테이블로 바인딩.
   (`get_record_sql`은 리터럴 테이블이 없을 수 있음 → FROM 절 단일 테이블 휴리스틱, 실패 시 스킵.)
2. **`get_records` / `get_recordset`** — `foreach ($recs as $r)`에서 요소 `$r`을 테이블로 바인딩.
3. **쓰기측 use-based 규칙(§4.3)** — `insert_record('table', $data)` / `update_record('table', $data)`처럼
   변수가 **리터럴 테이블과 함께 data 인자로 전달**되면 그 `$data`를 해당 테이블로 바인딩한다.
   (§4.1의 1·2는 대입 기반, 이 3은 사용 기반 — 둘 다 있어야 읽기+쓰기가 모두 동작. 스파이크 쿼리 #5로 실증.)
4. **기존 phpdoc 존중** — `@var`, `@param` 등 이미 달린 419건의 주석을 **덮어쓰지 않고 활용**한다.
   phpdoc이 있으면 자동추론보다 **우선**하고, 명시적 타입이 달린 변수엔 오탐 진단을 내지 않는다.
   (커스텀 `table:` 태그는 미도입 — §11 참고.)
5. **persistent 클래스**(`define_properties()`) — 커스텀 코드엔 현재 0건이나, 코어엔 존재.
   2차 타입 소스로 로드맵에 둔다(Phase 3).

### 4.2 추론 범위 (명시적 경계)
- **현재 함수/파일 스코프 내에서 `$var`의 가장 가까운 선행 대입만** 추적한다.
- 크로스 함수 전달, 리턴값 추론, 배열/객체 깊은 추적은 **범위 밖**. 이 경계가 구현 가능성을 보장한다.

### 4.3 양방향 가치 (읽기 + 쓰기)
- **읽기**: `$rec->` → 해당 테이블 컬럼 자동완성 + go-to-def(install.xml 라인) + hover(TYPE/COMMENT).
- **쓰기**: `$data = new stdClass(); $data->` 를 `insert_record('local_ubattend_config', $data)` 맥락에서
  컬럼으로 자동완성.
- **진단(최고 가치 단일 기능)**: `$rec->존재하지않는컬럼` 또는 insert/update 대상 객체의 잘못된 컬럼에
  **"column 'X' not in table 'Y'"** 경고 + quick fix(가장 가까운 컬럼명 제안). 런타임 에러가 실제로 여기서 난다.

---

## 5. 프로바이더 — 단계적 로드맵

"대부분의 기능"(mdlcode parity) 비전 전체를 로드맵으로 제시하되,
**Phase 1 = 백본 + 차별화 기능**부터 출시한다.

### Phase 1 — 백본 + 차별화 (MVP)
1. Workspace Resolver + ComponentMap + 파일 워처
2. **TableIndex** (install.xml, 코어+커스텀 동일 처리)
3. **StringIndex** (lang/en) — 가장 저렴·고가치
4. PHP Parse Layer (대입 추적 + 호출 인자 판별)
5. **DB 테이블/컬럼**: go-to-def, `$rec->` 자동완성, hover(한국어 COMMENT)
6. **stdClass 컬럼 진단** + quick fix (§4.3)
7. **언어 문자열**: `get_string('key','component')` go-to-def, 자동완성, hover(한국어 값), 누락 진단

### Phase 2 — mdlcode parity 확장
8. **Capabilities**: `has_capability`/`require_capability` go-to-def/자동완성/진단 (db/access.php)
9. **Mustache 템플릿**: `render_from_template('component/x')` → `.mustache` 이동; `{{#str}}` 인식
10. JS `Str.get_string` / AMD 모듈 이동
11. 웹서비스(`db/services.php`), 이벤트/태스크/스케줄드 콜백 인식

### Phase 3 — 생산성 도구
12. 코드 생성 마법사(플러그인 스캐폴드, capability, lang 문자열 추가)
13. persistent 클래스 타입 소스
14. CLI/웹서비스 실행 헬퍼

---

## 6. 성능

- **초기 색인**: 액티베이션 시 install.xml/lang/access.php를 한 번 파싱(대용량 대비 비동기·프로그레스).
- **증분 갱신**: `FileSystemWatcher`로 해당 파일만 재색인.
- **PHP 파싱**: 열린/편집 중 문서만, tree-sitter 증분. 키 입력마다 전체 재파싱 금지.
- **캐시**: 컴포넌트 맵·테이블 인덱스는 워크스페이스 단위 메모리 캐시(선택적으로 `globalState` 직렬화).

---

## 7. 테스트 전략

DDD 레이어가 테스트 피라미드를 그대로 만든다.
- **도메인 단위(가장 두껍게)**: 도메인이 순수하므로 `vscode` 없이 빠르게 검증. 특히 `RecordTypeInference`를
  fake `TableRepository`/`PhpSyntax`로 주입해 `$var`↔테이블 케이스(get_record/get_records/foreach/phpdoc)를 표 기반으로.
  `ColumnValidator` 오타 검출도 여기서.
- **인프라 어댑터 단위**: 파서(install.xml/lang/access.php) → 골든 픽스처(실제 `local/ubattend` 샘플) 스냅샷 테스트.
- **애플리케이션 유즈케이스**: 어댑터를 mock 하고 조율/DTO 계약 검증.
- **프로바이더 통합(가장 얇게)**: `@vscode/test-electron`으로 completion/definition/hover/diagnostics를 실제 확장 호스트에서.
- **픽스처**: hlulxp를 참조 구현으로 쓰되 경로 하드코딩 금지 — 축소 픽스처 워크스페이스를 리포에 포함.

---

## 8. 리스크

| 리스크 | 완화 |
|---|---|
| `get_record_sql`의 테이블 판별 난이도 | 단일 FROM 테이블만 휴리스틱, 애매하면 조용히 스킵(오탐 방지). |
| 대용량 install.xml 성능 | 비동기 스트리밍 파싱 + 증분 워처. |
| 스코프 오추론으로 인한 오탐 진단 | 진단은 확신 높은 경우만; 기본 심각도 Warning, 설정으로 끄기 제공. |
| ~~tree-sitter 네이티브 바인딩 배포~~ | **해소됨** — 스파이크(2026-07-27)로 `web-tree-sitter@0.20.8`+`tree-sitter-wasms@0.1.13` WASM in-process 로드 확인. 플랫폼 의존 없음. |

---

## 9. 범위 밖 (명시)
- PHPStorm/IntelliJ 지원
- 전역 타입 추론, 크로스 파일 데이터플로우
- Moodle 코어 코드 수정, 포매터/린터 대체
- 실제 DB 연결(스키마는 install.xml에서만 읽음)

---

## 10. 산출물 / 리포 구조(예정, DDD 레이어)
레이어 경계를 폴더로 강제한다. `domain/`은 `vscode`·`fs`·`tree-sitter`를 **import하지 않는다**(ESLint 규칙으로 감시).

```
vscode-csms-code/
  package.json                       # 확장 매니페스트(activationEvents, contributes, settings)
  src/
    domain/                          # ── 순수 도메인 (IO/프레임워크 무의존) ──
      shared/valueobjects/           # ComponentName, TableName, FieldName, SourceLocation
      moodle-model/                  # BC: Moodle Model
        table.ts (Table[aggregate], Field[VO])
        lang-string.ts  capability.ts  component.ts
        services/column-validator.ts
        ports/{table,string,capability,component}.repository.ts   # 인터페이스
      code-analysis/                 # BC: Code Analysis (차별화)
        record-binding.ts
        services/record-type-inference.ts
        ports/php-syntax.port.ts
    application/                     # ── 유즈케이스 (도메인 조율, vscode 무의존) ──
      completion/{complete-record-columns,complete-lang-string}.usecase.ts
      navigation/resolve-definition.usecase.ts
      hover/describe-symbol.usecase.ts
      diagnostics/{validate-record-columns,validate-lang-strings}.usecase.ts
      dto/                           # 레이어 간 DTO
    infrastructure/                  # ── 포트 구현(어댑터) ──
      xmldb/xmldb-table.repository.ts
      php-lang/php-lang-string.repository.ts
      access-php/access-php-capability.repository.ts
      workspace/{fs-component.repository,moodle-root-resolver}.ts
      tree-sitter/tree-sitter-php-syntax.ts
      indexing/{index-store,file-watchers,cache}.ts
    presentation/                    # ── VSCode 어댑터 (여기만 `vscode` import) ──
      providers/{record-column-completion,definition,hover,diagnostics,lang-string-completion}.provider.ts
      mappers/                       # vscode <-> DTO 매핑
    extension.ts                     # Composition Root: DI 조립 + 프로바이더 등록
  test/
    unit/                            # domain/application 단위 테스트(어댑터 mock)
    integration/                     # @vscode/test-electron
    fixtures/mini-moodle/            # 축소 픽스처 워크스페이스
```

---

## 11. 확정된 결정 (2026-07-27 사용자 승인)

1. **대상 IDE = VSCode.** PHPStorm 미지원(비목표).
2. **Phase 1 우선순위 = DB stdClass 인텔리전스 + 언어 문자열.** mdlcode의 나머지 기능은 Phase 2+.
3. **phpdoc 커스텀 힌트 태그(`table:xxx`)는 도입하지 않는다.** Phase 1은 **순수 자동추론**만.
   - 단, **기존 `@var` 주석(419건)은 계속 존중**한다 — 명시적으로 타입이 달린 변수엔 오탐 진단을 내지 않는다.
   - 비표준 태그는 타 도구 비호환·팀 규약 강요·YAGNI 문제. 자동추론 커버리지가 부족하다고 확인되면 그때(Phase 2+) 재검토.
     그때를 대비해 `RecordTypeInference`의 타입 소스는 **추가 가능한 구조**(전략 목록)로 설계한다.
4. **배포 = 사내 `.vsix`.** 마켓플레이스 배포 안 함.
5. **UI 언어 = 한국어 우선.**

---

## 부록 A — 참고 자료
- [MDLCode 공식](https://mdlcode.dev/)
- [MDLCode VSCode 마켓플레이스](https://marketplace.visualstudio.com/items?itemName=LMSCloud.mdlcode)
- [MDLCode JetBrains](https://plugins.jetbrains.com/plugin/28229-mdlcode--moodle-development)
- [Setting up VSCode — MoodleDocs](https://docs.moodle.org/dev/Setting_up_VSCode)
- 참조 코드베이스: `~/workspace/hlulxp` (Moodle 4.5.8, CSMS 커스텀 `local/ub*`)
