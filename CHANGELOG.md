# 변경 이력

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르고,
버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다(1.0.0 이전이므로 MINOR가 기능 추가·동작 변경, PATCH가 수정입니다).

## 버전 정책

- **MINOR(0.x.0)**: 새 기능 표면 추가, 사용자에게 보이는 동작 변경, 성능 특성 변경.
- **PATCH(0.0.x)**: 버그 수정, 또는 배포물(README·설정 설명)에 영향 있는 변경.
- **버전 유지**: 개발 문서만 바뀔 때(`docs/` 백로그·스펙·계획, 테스트 추가) — 사용자가 받는 것이 달라지지 않으므로 올리지 않습니다.
- 판단 기준은 "사이클이 끝났는가"가 아니라 **"사용자가 받는 산출물(.vsix)이 달라지는가"**입니다. 달라지는 사이클이 `main`에 병합될 때 **같은 사이클 안에서** 버전을 올리고 이 파일에 항목을 추가합니다 — 병합 후 별도 커밋으로 미루지 않습니다. 달라지지 않으면(위 "버전 유지") 올리지 않습니다.

## [0.8.0] — 2026-08-07

### 추가
- **Moodle 전역 인텔리전스**. `global $DB, $CFG, $USER;` 선언에는 타입 정보가 없어 일반 PHP 언어 서버가 아무것도 주지 못하던 자리를 채웁니다.
  - `$DB->`·`$PAGE->`·`$OUTPUT->` — 코어 클래스(`moodle_database`·`moodle_page`·`core_renderer`)의 public 멤버를 인자 시그니처·설명과 함께 완성하고, hover와 F12로 코어 소스의 선언 줄까지 갑니다. `$PAGE->context`처럼 `magic_get_*`로 구현된 매직 프로퍼티도 포함합니다(실측 41개).
  - `$CFG->` — `config-dist.php`와 플러그인 `settings.php`의 `admin_setting_*` 선언에서 모은 설정 키를 완성하고 선언 위치로 이동합니다(실측 1,622개).
  - `$USER->`·`$COURSE->`·`$SITE->` — `user`·`course` 테이블 컬럼을 기존 컬럼 엔진으로 완성·hover·이동합니다.
  - 전역이 지역 변수로 가려지면(`foreach ($users as $USER)`, 재대입) 전역 경로가 빠지고 기존 레코드 추론이 담당합니다.
  - `$DB` 완성은 자주 쓰는 메서드(`get_record`·`get_records_sql` 등)를 위로 올립니다 — `moodle_database`만 실측 126개입니다.

실측(hlulxp 4.5.8): `$DB` 접근 2,768회의 이름 47개 중 46개가 `moodle_database`에 선언돼 있고, `$CFG` 접근 1,627회 중 약 73%가 선언에서 확인됩니다.

### 성능
- 전역 색인은 **첫 요청에서 한 번** 만듭니다(코어 클래스 파싱 실측 105ms, 설정 키 수집 999ms). 활성화 경로에 넣으면 최대 이벤트 루프 정지가 42ms까지 올라가 기존 목표를 깹니다.

### 비고
- 전역에는 진단을 붙이지 않습니다. `$USER`는 사이트가 주입하는 런타임 필드가 실측 81건, `$CFG`는 `set_config`로 만들어지는 키가 실측 431회분이라 경고가 그대로 오탐이 됩니다.

## [0.7.0] — 2026-08-07

### 변경
- **플러그인 타입 매핑을 Moodle 선언에서 읽습니다**. 손으로 관리하던 30개 상수 대신 `lib/components.json`의 `plugintypes`와 각 플러그인의 `db/subplugins.json`(구버전은 `db/subplugins.php`)을 합쳐 구성합니다. 선언이 없는 버전에서는 기존 상수가 폴백으로 남아 커버리지가 줄지 않습니다.
- 그동안 어떤 기능에서도 보이지 않던 플러그인들이 색인됩니다 — `qbank`·`qbehaviour`·`qformat`·`quizaccess`·`assignsubmission`·`assignfeedback`·`tiny`·`gradingform`·`dataformat`·`media` 등.

실측(hlulxp 4.5.8):

| | 전 | 후 |
|---|---|---|
| 플러그인 타입 | 30 | **65** |
| install.xml(테이블) | 99 (657) | 126 (712) |
| lang 파일 | 497 | 645 |
| 템플릿 | 2,400 | 2,510 |
| AMD 모듈 | 1,034 | 1,201 |

구버전도 `subplugins.php` 해석만으로 늘어납니다 — 2.9.4에서 타입 30 → 43, install.xml 71 → 87, lang 433 → 483.

### 성능
- 타입 맵은 루트별로 캐시하고 활성화 시 비동기로 미리 채웁니다(실측 구성 85ms, 그중 최대 이벤트 루프 정지 1ms). 경로 역산이 워처 이벤트·정의 이동마다 이 맵을 쓰므로 캐시 미스가 확장 호스트를 막지 않아야 합니다.
- 색인 대상이 늘어 활성화 전체 빌드 wall-clock이 실측 597ms → 714ms(+20%)입니다. 최대 이벤트 루프 정지는 7ms로 같습니다.
- `coreSubsystemDirs`가 호출마다 하던 `lib/components.json` 읽기가 같은 캐시로 흡수됐습니다.

## [0.6.0] — 2026-08-06

### 추가
- **AMD 모듈 참조 이동**: `$PAGE->requires->js_call_amd('local_ubion/user', 'index')`의 첫 인자에서 F12를 누르면 `local/ubion/amd/src/user.js`로 이동합니다. 중첩 경로(`local_x/foo/bar`)와 코어 서브시스템(`core_form/submit` → `lib/form/amd/src/submit.js`)도 해석하며, 실측 해석률은 추출된 338건 중 328건(97.0%)입니다. 정규식으로 세면 354건이지만 차이 16건은 겹따옴표 리터럴 2건과 주석 처리된 호출이라 AST 기준에서 제외된 것입니다.
- `amd/src`의 모듈 파일에서 Shift+F12 → 그 모듈을 부르는 `js_call_amd` 호출처 목록.
- 해석되는 모듈 참조 하이라이팅. 설정 `csmscode.amd.highlightResolved`(기본 `true`).
- 코어 서브시스템 디렉터리 매핑을 `lib/components.json`에서 읽습니다. 이 파일이 없는 구버전에서는 코어 서브시스템 모듈만 해석되지 않고 플러그인 모듈은 그대로 동작합니다.

## [0.5.0] — 2026-08-06

### 추가
- **SQL 테이블 참조 이동**: PHP 문자열 안의 `{tablename}`에서 F12를 누르면 그 테이블을 선언한 `install.xml`의 `<TABLE>` 줄로 이동합니다. 단일 인용·이중 인용·heredoc·nowdoc을 모두 지원하고, `{$var}` 보간은 대상이 아닙니다.
- 해석되는 테이블 참조를 링크 색상으로 하이라이팅합니다. 설정 `csmscode.tables.highlightResolved`(기본 `true`)로 끌 수 있습니다.
- `install.xml`에 없는 이름(정규식 수량자 `{4}`, 다른 템플릿 문법 `{Bucket}` 등)에는 이동·하이라이트·진단 모두 반응하지 않습니다. 실측상 문자열 내 `{이름}` 중 실제 테이블은 57.8%뿐이라 진단은 제공하지 않습니다.

### 변경
- `csmscode.detectInSubfolders` 기본값이 `[]` → `["moodle"]`입니다. Moodle을 `moodle/` 하위에 두는 배치가 흔해, 이전에는 그런 워크스페이스에서 설정을 넣기 전까지 확장이 아무것도 하지 않았습니다. `version.php`와 `lib/db/install.xml`이 함께 있을 때만 루트로 인정하므로 이름만 같은 디렉터리를 잘못 잡지 않습니다.

### 수정
- PHP 파싱이 실패한 뒤 **다음 문서**가 예외 없이 노드가 누락된 트리로 파싱되던 문제. 이 tree-sitter 조합은 16진 이스케이프(`"\x00"`)가 있는 파일에서 파싱이 실패하는데, 중단된 파싱이 파서에 상태를 남겼습니다. 실패 즉시 파서 상태를 버리고 그 파일만 침묵합니다(잘못된 팩트는 진단 오탐으로 이어질 수 있어 침묵보다 위험합니다).

## [0.4.0] — 2026-08-06

### 성능
- **활성화 색인 비동기화**: install.xml·lang·템플릿 3종 색인의 파일 열거와 읽기를 모두 `fs.promises`로 바꾸고 200항목마다 이벤트 루프를 양보합니다. 실측 최대 확장 호스트 블로킹 콜드 ~1,730ms → **5.8ms**. 진행 상황은 상태바(`ProgressLocation.Window`)에 표시합니다.
- **워처 파일 단위 증분**: 파일 하나 저장에 전체 재색인하던 동작을 해당 파일만 갱신하도록 바꿨습니다. lang 저장 실측 122ms → ~6ms(최악 ~10ms), install.xml·템플릿은 1ms 미만.
- 세 색인의 동기 빌드·비동기 빌드·증분 세 경로가 **조립 함수 하나**를 통과하도록 구조를 고정하고, 등가성·수렴 테스트로 핀을 박았습니다.
- 워처가 폭주할 때 하이라이트·진단 갱신을 200ms로 합칩니다.

### 수정
- 템플릿 증분 갱신이 위치 배열 순서를 보존합니다 — 원본 파일 저장 후 F12·hover의 표시 순서가 뒤바뀌던 문제.
- 전체 재빌드 게이트를 예외 안전(`try/finally`)·반복형(`do/while` catch-up)으로 통합했습니다. 이전에는 빌드 중 예외가 나면 이후 모든 증분 동기화가 조용히 멈췄습니다.
- 역산이 실패한 경로에 대한 폴백 전체 재빌드를 제거했습니다(열거가 역산과 같은 규칙을 쓰므로 색인될 수 없어 이득이 없고, 진행 중 증분을 덮어쓸 위험만 있었습니다).

## [0.3.0] — 2026-08-05

### 추가
- **JS/AMD 인텔리전스**: `amd/src`의 `get_string`(`M.util.get_string`·`core/str` 양쪽)과 `Templates.render`/`renderForPromise` 리터럴에 정의 이동·hover·하이라이팅을 제공하고, lang·템플릿 참조 목록(Shift+F12)에 JS 호출처를 포함합니다. 생성물인 `amd/build`·`*.min.js`는 색인에서 제외합니다.
- JS 하이라이트를 `csmscode.strings.highlightResolved`·`csmscode.templates.highlightResolved` 설정별로 각각 라우팅합니다.

## [0.2.0] — 2026-08-05

### 추가
- **언어 문자열 인텔리전스**: `get_string('key', 'component')` 키 자동완성(한국어 값 미리보기)·정의로 이동(ko/en)·hover·누락 키 진단.
- **lang 파일 → 사용처 참조 이동**(Shift+F12) 및 해석되는 키 하이라이팅. 사용처 색인은 첫 요청 시 lazy 구축 + 저장 단위 증분.
- **Mustache 템플릿 인텔리전스**: `render_from_template('component/name', …)`에서 `.mustache`로 이동(테마 오버라이드 함께 표시)·템플릿 파일에서 사용처 참조 이동·해석 참조 하이라이팅.
- 설정 `csmscode.strings.highlightResolved`, `csmscode.templates.highlightResolved`.

### 수정
- **플러그인 타입 → 디렉터리 매핑**: `block`→`blocks`, `tool`→`admin/tool`, `qtype`→`question/type` 등 실제 디렉터리와 다른 20여 개 타입이 색인되지 않던 문제를 검증된 30개 매핑으로 고쳤습니다.
- **kill-on-reassign 추론**: 레코드 변수를 다른 값으로 재대입한 뒤의 오탐 경고 제거 + foreach 바인딩이 가려지던 문제.
- **진단 debounce + 팩트 캐시**: 문서별 300ms debounce와 텍스트 키 LRU 캐시(용량 8)로 타이핑 중 중복 파싱 제거.
- 컬렉션 메서드(`get_records`·`get_recordset` 등) 결과 변수 자체에 컬럼을 바인딩하지 않도록 정밀화 — 레코드는 foreach 항목 변수입니다.
- 심볼릭 링크된 플러그인 디렉터리 색인, `scopeContaining`의 클로저 바깥 바인딩 누수, 키 위치 계산의 접두부 충돌 버그.

## [0.1.0] — 2026-07-27

### 추가
- **DB 레코드 컬럼 인텔리전스**(Phase 1): `db/install.xml` 색인을 바탕으로 `$DB->get_record()`·`get_records()` + `foreach`·`insert_record`/`update_record` 인자·`@var` 주석으로 바인딩된 `stdClass` 변수의 컬럼 자동완성(한국어 `COMMENT` 포함)·정의로 이동·hover·오타 진단 + Quick Fix.
- Moodle 루트 자동 인식(코어 + 커스텀 플러그인), 파일 변경 감지 재색인.
- 설정 `csmscode.detectInSubfolders`, `csmscode.diagnostics.enable`.

---

0.1.0~0.4.0 항목은 2026-08-06에 커밋 기록(`9134bb2`…`c6e817a`)에서 역산해 정리했습니다.
버전 태그는 소급 생성하지 않았습니다.
