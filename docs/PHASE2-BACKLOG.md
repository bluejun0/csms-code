# CSMS Code — Phase 2 백로그 & 알려진 제한

Phase 1 (DB stdClass 인텔리전스)은 완료되었습니다. 아래는 종합 리뷰에서 도출된 후속 작업과 배포 전 필수 게이트입니다.

## 배포 전 필수 (하드 게이트)
- **통합 테스트를 CI/xvfb에서 통과시킬 것.** `@vscode/test-electron` 통합 테스트는 이 개발 샌드박스(headless WSL2)에서 Electron이 크래시(SIGTRAP)해 실행되지 않았다. 정적 컴파일(`tsc -p tsconfig.test.json`)은 통과. 이 테스트는 WASM 번들(`dist/`) + `activate()` 결선을 검증하는 **유일한** 커버리지이므로, 실배포 전 반드시 CI(예: `xvfb-run`)에서 녹색 확인 필요.
- **`package.json`에 실제 사내 git repository URL 지정.** 현재 `repository` 필드는 제거된 상태(지어낸 URL 방지). `package` 스크립트는 `--allow-missing-repository`로 동작.

## 알려진 제한 (Phase 1)
- **구조 분해·복합·참조 대입 미추적**: kill-on-reassign(2026-07-31)은 단순 변수 LHS 대입만 캡처한다. `[$a, $b] = …`, `+=`, `??=`, `=&` 등은 캡처되지 않아 이전 바인딩이 유지된다(낙관 동작, 실코드에서 레코드 변수에 드묾). `$rec = enrich($rec);` 같은 자기참조 재대입은 RHS 안의 `$rec` 사용에도 kill이 적용되어 인텔리전스가 침묵한다(오탐은 아님).
- **dataarg 위치 무관**: insert/update 힌트는 스코프 전역이라 재대입과 무관하게 폴백으로 평가된다(다중 테이블 모호 시 null 가드 유지). `new stdClass` 후 insert 패턴 보존을 위한 의도된 동작.
- **빈 클로저 스코프 미인식**: 팩트가 하나도 없는 클로저(대입·접근·foreach·phpdoc 전무)는 완성의 스코프 축소에 보이지 않아 바깥 스코프로 폴백한다(2026-08-04 최종 리뷰 잔여 갭 — 실코드에서 극히 드묾).
- **symlink 플러그인 watcher 미감지**: `**/db/install.xml` watcher는 심볼릭 링크된 디렉터리 내부의 파일 변경을 감지하지 못할 수 있다 — 링크된 플러그인의 install.xml 수정 후에는 창 재시작으로 재색인 필요. 초기 색인은 정상(2026-08-04 최종 리뷰).
- **템플릿 생성 순서에 따른 표시 순서 발산**: 이미 색인된 템플릿의 갱신은 위치 순서를 보존하지만, 새로 생성된 파일은 배열 끝에 추가된다. 열거 순서상 앞자리인 파일(예: 테마 오버라이드가 이미 있는 상태에서 원본을 새로 만드는 경우)이 나중에 생성되면 F12·hover의 표시 순서가 새 창에서 본 것과 달라질 수 있다(내용은 동일, 다음 전체 재색인 시 정렬됨 — 2026-08-05 최종 리뷰).
- **순수 stdClass 필드 미지원**: 인텔리전스는 **테이블을 알아낼 수 있는** stdClass에만 동작한다(추론 4경로가 모두 `tableExists()`를 통과해야 함 — `record-type-inference.ts`). `$data = new stdClass(); $data->title = …;` 처럼 DB에 가지 않는 객체는 바로 위에서 대입한 필드조차 완성되지 않는다. 실측 규모와 설계 방향은 아래 14번.
- **16진 이스케이프 파일 파싱 불가**: `"\x00"` 같은 16진 이스케이프가 있는 PHP 파일은 현재 조합(web-tree-sitter 0.20.8 + tree-sitter-wasms 0.1.13)에서 `Parser.parse()`가 예외를 던져 그 파일의 인텔리전스가 전부 침묵한다. 최소 재현 `<?php $a = "\x00";` — 8진(`\000`)·유니코드(`\u{...}`)·단일 인용은 정상이고 heredoc·nowdoc도 실패한다. 실패 시 `reset()`으로 파서 상태를 버려 다음 문서는 영향받지 않는다. hlulxp 실측 16개 파일(local/ vendor 10 + mod/ 번들 라이브러리 6)로 커스텀 플러그인 코드에는 없다. 코어에는 lib·admin·course에 119개. 해결은 아래 17번.
- **AMD 모듈 참조의 미해석 요인**: 실측 해석률은 추출된 338건 중 328건(97.0%) — 정규식으로 센 전체 호출 354건 기준으로는 약 93%다(차이 16건은 겹따옴표 2건 + 주석 처리된 호출). 남는 원인은 ~~① 미매핑 플러그인 타입~~(2026-08-07 타입 맵 전환으로 해소) ② 실제로 없는 모듈(`local_ubion/assign`·`mod_ubboard/ubboard` — 죽은 참조) ③ 겹따옴표 리터럴(실측 2건) ④ `lib/components.json`이 없는 구버전(3.5·2.9)에서 코어 서브시스템 모듈. 
- **SQL이 아닌 문자열의 오검출**: 테이블 참조는 문자열 안 `{이름}`을 모두 후보로 보고 색인에 있는 이름만 반응하므로, `index.php?id={course}`처럼 테이블과 같은 이름이 든 비SQL 문자열에도 링크 색상이 붙을 수 있다(F12는 무해, 실측 해석된 4,384건 중 이런 유형이 최대 280건).
- **lang 증분의 제거 비용**: `StringIndexStore.removeFile`이 색인 전체를 스캔하므로 lang 저장 시 증분이 실측 p50 2.2ms·p90 3.4ms·최악 10.4ms다(lang 645개 기준 — 색인이 커지면 이 비용도 함께 커진다). 전체 재색인(122ms)보다 훨씬 빠르지만 1ms 미만은 아니다. uri→key 역인덱스를 도입하면 더 줄일 수 있다.

## Phase 2 후속 작업 (우선순위 순)
1. ~~**kill-on-reassign 추론**~~ — ✅ 완료 (2026-07-31, 설계: `docs/superpowers/specs/2026-07-31-kill-on-reassign-design.md`). 재대입 오탐 제거 + foreach 가림 버그 수정.
2. ~~**진단 debounce + 파싱 공유**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-diagnostics-debounce-facts-cache-design.md`). 문서별 300ms debounce + 텍스트 키 LRU 팩트 캐시(용량 8).
3. ~~**`get_recordset` 직접 바인딩 제거**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-recordset-scope-polish-design.md`). get_records(배열)까지 넓혀 직접 바인딩은 단일 레코드 메서드(get_record/get_record_select)로만 한정.
4. ~~**symlink 플러그인 디렉터리 색인**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-symlink-index-hardening-design.md`). 심볼릭 링크 엔트리만 statSync로 확인, 깨진 링크는 조용히 제외.
5. ~~**비동기 활성화 색인**~~ — ✅ 완료 (2026-08-05, 설계: `docs/superpowers/specs/2026-08-05-indexing-performance-design.md`). 열거·읽기 모두 `fs.promises` + 200항목마다 양보, 상태바 진행률. 실측 활성화 블로킹 콜드 ~1,730ms → 0(비동기). 워처도 전체 재색인에서 파일 단위 증분으로(lang 저장 실측 122ms → 한 자릿수 ms, 최악 ~10ms).
6. ~~**nested subplugin 색인**~~ — ✅ 완료 (2026-08-07, 설계: `docs/superpowers/specs/2026-08-07-plugin-type-map-design.md`). 타입 맵을 Moodle 선언(`lib/components.json` + `db/subplugins.json|php`)에서 읽어 잔여 타입(qbank·tiny·quizaccess·assignsubmission 등)이 모두 해소됐다. hlulxp 실측 타입 30 → 65, 플러그인 +146.
7. **dead code 정리 또는 결선**: `parseFrankenstyle`, `TableRepository.allTableNames()`, `RecordAssignment.receiver`. (`IndexStore.updateFile/removeFile`은 2026-08-05 증분 워처에 결선되어 해소됨.)
8. **resolve/describe 중복 제거**: 프로퍼티 접근 lookup을 `findPropertyAccessAt(facts, atIndex)` 헬퍼로 추출.
9. **테스트 커버리지 보강**: `sameScope` 크로스스코프(추가됨), `parseFrankenstyle` null, `closestColumn` 비기본/동점, 다중 TABLE install.xml, `updateFile/removeFile/safeParse` 실패 경로.
10. **.vsix 정리**: `.gitignore`/`.mocharc.json`/`tsconfig.test.json` 등 dev 파일 제외.
11. ~~**`scopeContaining()`에 plainAssignments 반영**~~ — ✅ 완료 (2026-08-04, 같은 설계 문서). 일반 대입만 있는 클로저의 바깥 바인딩 누수 수정.
12. ~~**재발 방지 하드닝(2026-08-04 최종 리뷰)**~~ — ✅ 완료 (2026-08-04, 같은 설계 문서). scopeContaining 구조적 유도 + E2E 음성 핀 + get_records_select 핀.
13. **진단 code 네임스페이스 리네이밍**: 문자열 진단도 `csms.column.*` 코드를 재사용 중(동작은 정상) — `csms.fix.*` 등으로 일반화 + QuickFix 프로바이더명 정리. Plan 2 최종 리뷰(2026-08-04) 발견.
14. **순수 stdClass 로컬 필드 인텔리전스** (2026-08-06 실측 — 사용자 요청으로 조사, 착수는 보류): `new stdClass()`/`(object)` 캐스트 이후 **그 스코프에서 대입한 필드**를 완성·hover·정의 이동(대입한 줄로 점프)에 쓴다.
    - **실측(hlulxp 커스텀 PHP 3,370개, tree-sitter로 함수 스코프 단위)**: 순수 stdClass 변수 **275개**(서로 다른 스코프 217개), 대입된 고유 필드 **1,237개**(변수당 p50 3·p90 10·max 24), `return $obj`로 나가는 것 88개, `(object)` 캐스트 30개. ※ 파일 단위 정규식으로 세면 639변수/4,310필드로 2배 이상 과대 계상된다(`$data`·`$record` 변수명이 함수마다 재사용되므로). 스코프 단위 숫자를 쓸 것.
    - **진단은 비목표**(오탐 필연): stdClass 필드 집합은 닫히지 않는다 — 참조 인자로 채우기(`function fill(&$o)`), 동적 이름(`$o->$k` — 실측 336곳), `(object)$array`. 다만 "쓰지 않은 필드를 읽는" 변수는 실측 3개(필드 4개)뿐이라 **완성·hover·F12의 정확도는 충분하다**.
    - **설계 방향**: ① `facts.ts`에 `PropertyWrite { varName, property, index, scope }` 추가 — 기존 `Q_PROP`은 대입 좌·우변을 구분하지 못하므로 `(assignment_expression left: (member_access_expression object: (variable_name (name) @var) name: (name) @prop))` 쿼리가 따로 필요하다. ② stdClass 여부 판정에 새 경로를 만들지 말고 기존 `plainAssignments` + `nearestPreceding`(kill-on-reassign 기계)을 재사용해 "가장 가까운 선행 대입의 RHS가 `new stdClass`/`(object)` 캐스트인가"만 추가로 알면 된다. ③ **병합 의미는 합집합으로 확정**: 테이블 바인딩과 로컬 필드 쓰기가 둘 다 있는 변수(실측 43개 — `$rec = $DB->get_record(…); $rec->extra = 1;`)는 컬럼 ∪ 로컬 필드를 출처 구분해 표시한다. 이건 `complete-record-columns.ts`와 기존 dataarg 동작을 건드리므로 스펙에서 확정하고 들어갈 것.
    - **스파이크 완료**: 아래 3개 쿼리가 현재 grammar(`tree-sitter-wasms/out/tree-sitter-php.wasm`)에서 컴파일·매칭됨을 2026-08-06에 확인했다. 실측도 이 쿼리로 했으므로 그대로 쓰면 된다.
      ```
      (assignment_expression left: (member_access_expression
        object: (variable_name (name) @var) name: (name) @prop))          ; 프로퍼티 쓰기
      (assignment_expression left: (variable_name (name) @var)
        right: (object_creation_expression (name) @cls))                  ; new stdClass
      (assignment_expression left: (variable_name (name) @var)
        right: (cast_expression type: (cast_type) @ctype))                ; (object) 캐스트
      ```
      동적 프로퍼티 접근은 `(member_access_expression object: (variable_name (name)) name: (variable_name))`로 세었다(집합이 닫히지 않는다는 근거).
15. **알려진 전역·함수의 테이블 바인딩** (14번과 함께 검토, 보류): `$USER`→`user`, `$COURSE`/`$SITE`→`course`, `get_course()`→`course`, `get_coursemodule_from_id()`/`_from_instance()`→`course_modules`. 실측 접근 `$USER->` 636회(그중 **87%가 실제 user 컬럼과 일치**)·`$COURSE->` 43(100%)·`$SITE->` 78(100%), 함수 쪽 45회. **100%를 과신하지 말 것** — 표본이 43·78건뿐이고 대부분 `->id`/`->fullname`/`->shortname`이다. `$SITE`는 사이트 코스 레코드(id=1)라 `course` 행이 맞지만, `$COURSE`는 부트스트랩 경로에서 필드 일부만 채워진 부분 객체일 수 있다. 따라서 완성 후보로만 쓴다. **15번 전체에서 진단은 제외**: `$USER`의 불일치 81건은 사이트가 주입하는 런타임 필드(`ubion` 62·`access`·`editing`·`realuser`)라 경고를 붙이면 즉시 오탐이 된다. `$CFG->`는 1,531회로 가장 많지만 config 키-값이라 테이블이 없어 대상 아님.
16. **테이블 표면의 남은 조각들** (2026-08-06 SQL 테이블 이동에서 의도적으로 제외 — 설계: `docs/superpowers/specs/2026-08-06-sql-table-navigation-design.md`):
    - **테이블 hover**: `{table}` 위에 컴포넌트·컬럼 수·`<TABLE COMMENT>`를 띄운다. `parseInstallXml`이 TABLE의 COMMENT를 읽고도 `Table`에 넘기지 않으므로(현재 버려짐) 모델에 `comment` 한 줄을 추가해야 한다. 커스텀 플러그인 install.xml의 COMMENT는 한국어라 값이 크다.
    - **`$DB` 메서드 인자 리터럴 이동**: `$DB->get_records('user', …)`·`count_records`·`delete_records` 등의 테이블 이름 문자열에서도 F12. 실측 `$DB->` 호출 2,528건. 쿼리는 수신자 `DB` + 첫 문자열 인자 하나면 되고, 해석 실패는 그대로 침묵이므로 `get_records_sql`의 SQL 첫 인자와 충돌하지 않는다.
    - **install.xml → 사용처 참조(Shift+F12)**: `<TABLE>` 줄에서 그 테이블을 쓰는 SQL·`$DB` 호출을 모두 찾기. `PhpUsageIndex`에 테이블 참조 종류를 추가해야 하므로 앞의 두 개보다 크다.
17. **tree-sitter grammar/런타임 조합 갱신**: 16진 이스케이프 파싱 실패(위 "알려진 제한")를 없앤다. 현재 `web-tree-sitter` 0.20.8 + `tree-sitter-wasms` 0.1.13. 상위 버전은 `Parser.init`·`Query` API가 달라 어댑터 수정이 필요하고, `dist/`로 복사하는 WASM 산출물 경로도 함께 확인해야 한다. 대안(우회): 파싱 직전에 `\x`를 같은 길이의 무해한 문자열로 치환하면 오프셋이 보존돼 위치 계산이 그대로 유효하다 — 영향 파일이 vendor·라이브러리뿐이라 현재는 채택하지 않았다.
18. **`get_record_sql` 결과 변수의 컬럼 추론** (별도 사이클 — 14·15번보다 위험): 실측 `get_record_sql`+`get_records_sql` 836회 중 호출부 리터럴에서 `{table}`이 1개만 나오는 건 244회, 조인 77회, **리터럴에서 아예 못 찾는 게 515회**(대부분 `$sql`을 위에서 조립해 넘김 → 변수 해석이 선행돼야 실질 커버리지가 나온다). 조인·별칭이 있으면 반환 필드는 테이블 컬럼이 아니라 select 목록이므로 `SELECT *`(198회)만 안전하다.
19. ~~**`lib/components.json`으로 `PLUGIN_DIRS`를 대체**~~ — ✅ 완료 (2026-08-07, 같은 설계 문서). `components.json`만으로는 부족했다 — 서브플러그인 타입은 각 플러그인의 `db/subplugins.json`(구형식 `.php`)에만 있어 두 출처를 합쳐야 했다. `coreSubsystemDirs`의 호출마다 파일 읽기도 같은 캐시로 해소.
20. **JS 파일의 모듈 참조 이동**: `import 'local_x/y'`·`require(['local_x/y'])`에서도 모듈 파일로 이동(실측 1,161건·97% 해석 가능). VS Code 기본 JS 지원은 Moodle AMD 이름을 해석하지 못한다. 이미 만든 `AmdIndex`를 그대로 쓰고 JS 스캐너에 정규식 두 개만 추가하면 된다.

## Plan 2 (별도 계획 예정)
- ~~**언어 문자열 인텔리전스**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-lang-string-intelligence-design.md`). get_string 키 완성/정의 이동(ko·en)/hover(한국어 값)/누락 진단. 비목표: get_strings·lang_string·addHelpButton·AMD str, double-quoted/heredoc lang 값, component 이름 완성.
- ~~**lang→참조 이동 + 해석 키 하이라이팅**~~ — ✅ 완료 (2026-08-05, 설계: `docs/superpowers/specs/2026-08-05-lang-references-highlight-design.md`). 사용처 색인은 lazy(첫 요청, 진행률) + 저장 단위 증분, 하이라이트는 textLink.foreground.
- ~~**Mustache 템플릿 인텔리전스**~~ — ✅ 완료 (2026-08-05, 같은 설계 문서). render_from_template 정의 이동(테마 오버라이드 포함)·템플릿에서 참조 이동·해석 참조 하이라이팅. 비목표: JS `Templates.render()`, 템플릿 이름 완성, .mustache 내부 인텔리전스.
- ~~**JS/AMD 인텔리전스**~~ — ✅ 완료 (2026-08-05, 설계: `docs/superpowers/specs/2026-08-05-js-amd-intelligence-design.md`). amd/src의 get_string·Templates.render에 이동·hover·하이라이트, 참조 목록 통합. 비목표: JS 진단(AST 부재로 오탐 위험)·JS 자동완성·getStrings 배열·TypeScript.
- ~~**SQL 테이블 참조 이동**~~ — ✅ 완료 (2026-08-06, 설계: `docs/superpowers/specs/2026-08-06-sql-table-navigation-design.md`). 문자열 안 `{table}`에서 install.xml `<TABLE>` 줄로 이동 + 해석 참조 하이라이팅, 네 가지 인용 방식 지원. 비목표: 진단(해석률 57.8%), hover, `$DB` 인자 리터럴, install.xml→사용처 참조(위 16번).
- ~~**AMD 모듈 참조 이동**~~ — ✅ 완료 (2026-08-06, 설계: `docs/superpowers/specs/2026-08-06-amd-module-navigation-design.md`). `js_call_amd` 첫 인자에서 `amd/src` 모듈로 이동·해석 참조 하이라이팅·모듈 파일에서 사용처 참조. 코어 서브시스템은 `lib/components.json`으로 해석. 비목표: 진단, JS의 import·require 이동(위 20번), 모듈 이름 자동완성, 두 번째 인자(함수명) 이동.
- 이후 capability, 웹서비스 등 mdlcode parity 확장.
