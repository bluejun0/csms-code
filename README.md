# CSMS Code

CSMS/Moodle(코스모스, `*lxp`/`*lms` 계열) 플러그인 개발을 위한 VSCode 확장입니다.
Moodle 코드는 DB 레코드를 대부분 `stdClass`로 다루기 때문에, 일반 PHP 언어 서버는
`$DB->get_record(...)` 결과의 프로퍼티를 자동완성하지 못합니다. 이 확장은 워크스페이스에
열린 Moodle 루트를 자동으로 찾아 core + 커스텀 플러그인의 `db/install.xml`을 색인하고,
그 정보를 바탕으로 **DB 레코드 컬럼 인텔리전스**를 제공합니다.

## 주요 기능

- **컬럼 자동완성**: `$config = $DB->get_record('local_ubattend_config', ...)` 다음 줄에서
  `$config->` 입력 시 해당 테이블의 컬럼 목록과 한국어 설명(install.xml의 `COMMENT`)을 표시합니다.
  `get_records`로 얻은 배열을 순회하는 `foreach ($rows as $r)`의 `$r->`, 그리고
  `insert_record`/`update_record`에 넘기는 쓰기 측 `$data->`도 동일하게 지원합니다.
- **정의로 이동 (F12)**: 컬럼에서 정의로 이동하면 해당 테이블의 `install.xml` 내
  `<FIELD>` 선언 줄로 바로 이동합니다.
- **Hover**: 컬럼 위에 마우스를 올리면 `table.column  type  한국어 설명` 형식으로 표시합니다.
- **오타 진단 + Quick Fix**: 존재하지 않는 컬럼(예: `$config->coursid`)을 참조하면 노란 경고를
  띄우고, 가장 유사한 실제 컬럼명(예: `courseid`)으로 고치는 quick fix를 제공합니다.
- **타입 추론 범위**: 변수를 감싼 스코프 안에서 가장 가까운 선행 대입을 추적합니다. 함수·메서드·클로저
  안은 물론 **함수 밖 최상위 스크립트**(Moodle 페이지의 일반적인 모양 — `?>` HTML `<?php`로 끊겨 있어도)에서도
  동작하며, 파일 전체가 하나의 스코프입니다. 파일을 넘는 추론(`include`한 변수)은 범위 밖입니다.
- **워크스페이스 자동 인식**: Moodle 루트와 core + 커스텀 플러그인을 자동으로 찾아 색인하며,
  파일 변경을 감지해 증분 갱신합니다. 플러그인 타입 → 디렉터리 매핑은 Moodle 자신의 선언
  (`lib/components.json`, 각 플러그인의 `db/subplugins.json`·`.php`)에서 읽으므로 서브플러그인
  (`quizaccess`·`assignsubmission`·`qbank`·`tiny` 등)도 함께 색인됩니다.
- **언어 문자열 인텔리전스**: `get_string`·`print_string`·`print_error`·`new moodle_exception`·`new lang_string`·`new help_icon`의 `('key', 'component')`뿐 아니라 **컴포넌트가 변수·`$this->프로퍼티`·클래스 상수인 호출도** 같은 파일의 문자열 리터럴까지 거슬러 올라가 해석하고, 컴포넌트를 생략한 호출도 Moodle 규칙대로 갑니다(`get_string('ok')` → core, `moodle_exception('code')` → `error`). 키 자동완성(한국어 값 미리보기)·정의로 이동(ko/en)·hover·누락 키 진단·해석 키 하이라이팅. 사용처 참조(Shift+F12)는 **코드의 키 위에서도, lang 파일의 `$string` 줄에서도** 동작하고, 단축키를 몰라도 찾아갈 수 있게 lang 파일에는 줄마다 **"사용 N건" 버튼**(CodeLens)이, 코드 쪽 hover 아래에는 **"사용 N건 보기" 링크**가 붙습니다.
- **Mustache 템플릿 인텔리전스**: `render_from_template('component/name', …)`에서 `.mustache` 파일로 이동(테마 오버라이드가 있으면 함께 표시)·템플릿 파일에서 사용처 참조 이동(Shift+F12)·해석되는 참조 하이라이팅
- **전역 인텔리전스**: `global $DB, $CFG, $USER;`로 가져온 전역에 완성·hover·정의 이동을 제공합니다.
  `$DB->`·`$PAGE->`·`$OUTPUT->`은 코어 클래스의 메서드·프로퍼티(매직 프로퍼티 포함),
  `$CFG->`는 `config-dist.php`·`settings.php`에서 모은 설정 키, `$USER->`·`$COURSE->`·`$SITE->`는
  해당 테이블 컬럼입니다. 전역이 지역 변수로 가려지면 기존 레코드 추론이 담당합니다.
- **Mustache 내부 인텔리전스**: `.mustache` 안에서 `{{> comp/name}}`·`{{< comp/name}}`에 F12로 그 템플릿 파일로
  이동하고(테마 오버라이드 함께), `{{#str}}key, component{{/str}}`에서 lang 파일로 이동·hover로 한국어 값을
  봅니다. 해석되는 참조는 링크 색상으로 표시되고, 템플릿의 Shift+F12 사용처 목록에 **다른 mustache의
  partial 참조도 포함**됩니다. 실측 partial 98.8%·문자열 99.2% 해석.
- **AMD 모듈 참조 이동**: `$PAGE->requires->js_call_amd('local_ubion/user', 'index')`의 첫 인자에서 F12를
  누르면 `local/ubion/amd/src/user.js`로 이동하고, 모듈 파일에서 Shift+F12로 그 모듈을 부르는 호출처를
  찾습니다. 해석되는 참조는 링크 색상으로 표시됩니다. 중첩 경로(`local_x/foo/bar`)와 코어 서브시스템
  (`core_form/submit` → `lib/form/amd/src/submit.js`)도 해석합니다.
- **테이블 참조 이동**: SQL 문자열의 `{tablename}`과 `$DB->update_record('local_x', …)` 같은 DML 메서드의
  테이블 인자에서 F12를 누르면 그 테이블을 선언한
  `install.xml`의 `<TABLE>` 줄로 이동하고, 해석되는 참조를 링크 색상으로 표시합니다.
  단일 인용·이중 인용·heredoc·nowdoc을 모두 지원하며, `install.xml`에 없는 이름
  (정규식 수량자 `{4}`, 다른 템플릿 문법 `{Bucket}` 등)에는 아무 반응도 하지 않습니다.
- **JS/AMD 인텔리전스**: `amd/src`의 `get_string`(`M.util.`·`core/str` 모두)·`Templates.render` 리터럴에 정의 이동·hover·하이라이팅, lang/템플릿 참조 목록에 JS 호출처 포함 (`amd/build`·`.min.js`는 생성물이라 제외)
- **설정 키 인텔리전스**: `get_config('local_x', 'key')`·`set_config('key', $v, 'local_x')`의 키에서 F12로 `settings.php`의
  `admin_setting_*` 선언으로 이동하고(`$name = $pluginname . '/key';` 관용구를 따라감), hover로 설정 클래스·위치를 봅니다.
  해석되는 키는 링크 색상, 코드↔선언 양방향 Shift+F12, `settings.php` 선언 줄 위 **"사용 N건" 버튼**, hover 아래
  **"사용 N건 보기"** 링크, `get_config('local_x', '|')` 키 완성. 플러그인 이름은 저장 키 그대로 비교합니다
  (`ubboard`와 `mod_ubboard`는 다른 설정). `$this->pluginname` 같은 동적 플러그인도 문자열과 같은 전파로 해석합니다.
  `settings.php`를 저장하면 선언 색인이 그 파일만 즉시 갱신됩니다.

## 이 확장이 준 결과인지 확인하기

자동완성 항목의 오른쪽 끝과 hover 아래에 `csms-intelli` 표시가 붙습니다 — 다른 PHP 확장이 준 결과와
구분하기 위한 것입니다. 화면 아래 상태 표시줄에도 `csms-intelli`와 색인된 테이블 수가 계속 표시되고,
마우스를 올리면 Moodle 루트 경로와 테이블·언어 문자열·템플릿·AMD 모듈 색인 수를 볼 수 있습니다.
색인 중에는 회전 아이콘으로 바뀝니다. 표시가 거슬리면 `csmscode.showSourceLabel`로 끌 수 있습니다
(상태 표시줄은 설정과 무관하게 남습니다).

## 설정

| 설정 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `csmscode.php.selectDollarInWord` | `boolean` | `true` | PHP에서 `$`를 단어의 일부로 봅니다 — 더블클릭·Ctrl+D가 `$config`를 통째로 선택합니다. |
| `csmscode.showSourceLabel` | `boolean` | `true` | 자동완성·hover에 `csms-intelli` 출처 표시를 붙입니다. |
| `csmscode.detectInSubfolders` | `string[]` | `["moodle"]` | Moodle 루트가 워크스페이스 하위 폴더에 있을 때 탐색할 폴더명 목록. `version.php`와 `lib/db/install.xml`이 함께 있을 때만 루트로 인정합니다. |
| `csmscode.diagnostics.enable` | `boolean` | `true` | DB 레코드 컬럼 오타 진단을 켭니다. `false`로 설정하면 진단이 즉시 사라집니다. |
| `csmscode.strings.highlightResolved` | `boolean` | `true` | 해석되는 get_string 키를 링크 색상으로 하이라이팅 |
| `csmscode.strings.codeLens` | `boolean` | `true` | lang 파일의 `$string['key']` 줄 위에 "사용 N건" 버튼(CodeLens)을 표시. 색인 전에는 "사용 찾기"로 보이고 클릭이 색인을 만듭니다 |
| `csmscode.templates.highlightResolved` | `boolean` | `true` | 해석되는 render_from_template 참조를 링크 색상으로 하이라이팅 |
| `csmscode.amd.highlightResolved` | `boolean` | `true` | 해석되는 AMD 모듈 참조(`js_call_amd`의 첫 인자)를 링크 색상으로 하이라이팅 |
| `csmscode.tables.highlightResolved` | `boolean` | `true` | SQL 문자열에서 install.xml로 해석되는 테이블 참조(`{table}`)를 링크 색상으로 하이라이팅 |
| `csmscode.config.highlightResolved` | `boolean` | `true` | settings.php 선언으로 해석되는 `get_config`·`set_config` 키를 링크 색상으로 하이라이팅 |
| `csmscode.config.codeLens` | `boolean` | `true` | settings.php의 `admin_setting` 선언 줄 위에 "사용 N건" 버튼(CodeLens)을 표시 |

## 개발

```bash
npm install
npm run compile        # tsc -noEmit + esbuild
npm run test:unit       # 단위 테스트 (mocha)
npm run lint            # eslint
npm run package         # esbuild(production) + vsce package → csms-code-<version>.vsix
```

수동 검증 절차는 [docs/manual-verification.md](docs/manual-verification.md)를 참고하세요.

## 알려진 제한 (Known limitations)

추론은 한 파일 안의 로컬 데이터플로우만 추적합니다(파일을 넘지 않습니다). 재대입(`$rec = build_row();`)은
추적해 바인딩을 끊지만(kill-on-reassign), 구조 분해(`[$a, $b] = …`)·복합 대입(`+=`, `??=`)·
참조 대입(`=&`)은 캡처하지 않아 이전 바인딩이 남습니다. 오탐이 생기면
`csmscode.diagnostics.enable`로 진단을 끄거나 해당 변수에 정확한 `@var` 주석을 달 수 있습니다.
`"\x00"` 같은 16진 이스케이프가 있는 PHP 파일은 현재 tree-sitter 조합에서 파싱이 실패해 그 파일의
인텔리전스가 전부 침묵합니다(다른 파일에는 영향이 없습니다). 실측상 vendor·번들 라이브러리 파일에만
해당합니다.

컴포넌트가 동적인 `get_string` 호출은 정의 이동·hover·하이라이트·진단이 되지만, **사용처 목록(Shift+F12)과
"사용 N건" 개수에는 나타나지 않습니다**(사용처 색인이 정규식 기반이라 리터럴 컴포넌트만 봅니다). 플러그인이
동적인 `get_config` 호출도 같습니다.

설정 키는 **플러그인 설정만** 다룹니다. 코어 키(`get_config('core', …)`·`set_config('k', $v)`·`$CFG->k`)의 참조,
`$c = get_config('local_x'); $c->key` 통째 접근, 누락 키 진단(런타임에 `set_config`로만 만들어지는 키가 있어 오탐이
필연)은 범위 밖입니다. 선언을 정규식으로 읽으므로 `settings.php`의 관용구를 벗어난 선언(함수 반환값·배열)은 침묵합니다.

전체 목록은 [docs/PHASE2-BACKLOG.md](docs/PHASE2-BACKLOG.md)의 "알려진 제한"을 참고하세요.
버전별 변경 이력은 [CHANGELOG.md](CHANGELOG.md)에 있습니다.

## 비목표

- PHPStorm 지원
- 완전한 PHP 타입 추론 / 전역 데이터플로우
- Moodle 코어 자체 수정, 린터/포매터 대체
