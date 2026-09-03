# CSMS Code — 기능 명세

CSMS/Moodle(코스모스, `*lxp`/`*lms` 계열) 플러그인 개발용 VSCode 확장이 **현재 제공하는 기능**을
대상별로 정리한 문서입니다. 설치·개발 절차는 [README](../README.md), 수동 검증 절차는
[manual-verification.md](manual-verification.md)를 보세요.

---

## 1. 무엇을 하는가

Moodle 코드는 DB 레코드를 대부분 `stdClass`로 다루고, 언어 문자열·템플릿·AMD 모듈·설정 키·테이블을
모두 **문자열 리터럴**로 가리킵니다. 일반 PHP 언어 서버는 이 문자열들을 그저 문자열로 보기 때문에
완성도, 이동도, 오타 경고도 주지 않습니다.

이 확장은 워크스페이스에서 Moodle 루트를 찾아 그 규칙(`db/install.xml`, `lang/*/*.php`,
`templates/**/*.mustache`, `amd/src/**/*.js`, `settings.php`)을 색인하고, 그 문자열들을
**이동할 수 있는 심볼**로 바꿉니다.

## 2. 활성화와 워크스페이스 인식

**활성화 조건** — PHP 또는 JavaScript 파일을 열 때, 또는 워크스페이스에 `version.php`
(한 단계 하위 폴더 포함)가 있을 때 활성화됩니다.

**Moodle 루트 판정** — 열린 폴더에서 위로 올라가며 `version.php`와 `lib/db/install.xml`이
**함께** 있는 디렉터리를 찾습니다. 각 단계에서 `csmscode.detectInSubfolders`에 적힌 하위 폴더
(기본값 `["moodle"]`)도 함께 봅니다. 루트를 찾지 못하면 확장은 아무 것도 하지 않습니다.

**플러그인 타입 → 디렉터리 매핑** — 하드코딩된 표가 아니라 Moodle 자신의 선언에서 읽습니다:
`lib/components.json`, 그리고 각 플러그인의 `db/subplugins.json`·`db/subplugins.php`.
따라서 `quizaccess`·`assignsubmission`·`qbank`·`tiny` 같은 서브플러그인도 함께 색인됩니다.

**색인 대상 (활성화 직후 백그라운드)**

| 색인 | 읽는 곳 |
|---|---|
| 테이블·컬럼 | `lib/db/install.xml` + 모든 플러그인의 `db/install.xml` |
| 언어 문자열 | `lang/en`, `lang/ko`(코어) + 플러그인의 `lang/{en,ko}/<component>.php` |
| 템플릿 | `**/templates/**/*.mustache` |
| AMD 모듈 | `**/amd/src/**/*.js` (`amd/build`·`.min.js`는 생성물이라 제외) |

**색인 대상 (첫 요청 시 지연 생성)**

| 색인 | 읽는 곳 |
|---|---|
| 코어 클래스 멤버 | `moodle_database`·`moodle_page`·`core_renderer` |
| 설정 키 선언 | 모든 `settings.php`, `admin/settings/*.php` |
| 사용처 색인 | 루트 전체의 PHP·JS·mustache (§11) |

**증분 갱신** — 파일 워처가 `db/install.xml`, `lang/*/*.php`, `templates/**/*.mustache`,
`amd/src/**/*.js`, `settings.php`, `admin/settings/*.php`를 감시해 **바뀐 파일만** 다시 읽습니다.
`db/subplugins.{json,php}`·`lib/components.json`이 바뀌면 타입 맵을 버리고 전체를 다시 색인합니다.
색인이 도는 중에 들어온 변경은 빌드가 끝난 뒤 이어서 적용됩니다.

**색인 전 조회는 침묵합니다** — 빈 결과를 주고 색인이 끝나면 열린 문서를 한 번 다시 그립니다.
활성화가 편집을 멈추지 않습니다.

---

## 3. 기능 한눈에 보기

| 대상 | 완성 | F12 정의 | Hover | 참조 (Shift+F12 진입점) | CodeLens | 하이라이트 | 진단 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| DB 레코드 컬럼 `$rec->col` | ✅ | ✅ | ✅ | — | — | — | ✅ |
| 언어 문자열 키 (PHP) | ✅ | ✅ | ✅ | ✅ (양방향) | ✅ (lang 파일) | ✅ | ✅ |
| Mustache 템플릿 참조 (PHP) | — | ✅ | — | ✅ (템플릿 파일) | ✅ (템플릿 파일) | ✅ | — |
| AMD 모듈 참조 (PHP) | — | ✅ | — | ✅ (모듈 파일) | ✅ (모듈 파일) | ✅ | — |
| SQL·DML 테이블 참조 | — | ✅ | — | ✅ (install.xml) | ✅ (install.xml) | ✅ | — |
| 플러그인 설정 키 | ✅ | ✅ | ✅ | ✅ (양방향) | ✅ (settings.php) | ✅ | — |
| Moodle 전역 멤버 | ✅ | ✅ | ✅ | — | — | — | — |
| `.mustache` 내부 참조 | — | ✅ | ✅ | ✅ (`{{#str}}` 키) | — | ✅ | — |
| `amd/src` JS 리터럴 | — | ✅ | ✅ | ✅ (`get_string` 키) | — | ✅ | — |

괄호는 **어디서** 그 기능이 나오는지입니다 — 참조 목록과 CodeLens 버튼은 대상 파일 쪽(lang 파일·
템플릿 파일·모듈 파일·`install.xml`·`settings.php`)에 붙고, 호출 지점에서 여는 것은 문자열·설정
두 종류만 양방향입니다. `.mustache`·`amd/src` JS 파일의 맨 위 버튼은 각각 템플릿·AMD 모듈 행이
담당합니다.

---

## 4. DB 레코드 컬럼 인텔리전스

`install.xml`의 `<FIELD>` 선언(이름·타입·`COMMENT`의 한국어 설명)을 stdClass 프로퍼티에 붙입니다.

**타입 추론 4경로** — 변수를 감싼 스코프 안에서 가장 가까운 선행 이벤트가 이깁니다.

1. **PHPDoc** — `/** @var local_x_table $rec */`. 다른 경로를 모두 이기는 최우선 근거이자
   오탐 회피 수단입니다.
2. **직접 대입** — `$rec = $DB->get_record('table', …)` / `get_record_select`.
   단일 레코드를 돌려주는 메서드만 변수 자체에 바인딩합니다.
3. **foreach 항목** — `$rows = $DB->get_records('table', …)` 뒤의 `foreach ($rows as $r)`에서
   `$r`에 바인딩합니다. `get_records`·`get_records_select`·`get_recordset`·`get_recordset_select`가
   대상이며, **배열·recordset 변수 자체는 레코드가 아닙니다.**
4. **쓰기 측 인자** — `insert_record('table', $data)`·`update_record('table', $data)`에 넘기는
   `$data`. `$data = new stdClass()` 뒤에 필드를 채우는 패턴을 위해 스코프 전역 폴백으로 평가되고,
   같은 스코프에서 여러 테이블에 넘겨져 모호하면 침묵합니다.

**재대입 추적(kill-on-reassign)** — 위 이벤트보다 나중에 오는 일반 대입(`$rec = build_row();`)이
바인딩을 끊습니다. 대입 이후 위치에서는 완성·진단이 나오지 않습니다.

**스코프** — 함수·메서드·클로저는 물론 **함수 밖 최상위 스크립트**에서도 동작합니다.
Moodle 페이지처럼 `?>` HTML `<?php`로 여러 번 끊겨 있어도 파일 전체가 하나의 스코프입니다.

**제공 기능**

- **완성** — `$rec->` 입력 시 컬럼 목록 + 타입 + 한국어 설명.
- **F12** — 그 테이블의 `install.xml` 안 `<FIELD>` 선언 줄로 이동.
- **Hover** — `table.column  type  한국어 설명`.
- **진단 + QuickFix** — 존재하지 않는 컬럼(`$config->coursid`)에 경고를 띄우고 가장 가까운
  실제 컬럼명(`courseid`)으로 고치는 전구를 제공합니다. 진단 code는 `csms.column.<제안>`이고,
  `csmscode.diagnostics.enable`로 끌 수 있습니다. 타이핑 중에는 문서별 300ms 디바운스로 미루고,
  파일을 열거나 설정을 토글하면 즉시 갱신합니다.

**적용 범위**

- **테이블을 알아낼 수 있는 stdClass에만** 동작합니다. 네 경로가 모두 색인에 있는 테이블 이름으로
  귀결되어야 하므로, `$data = new stdClass(); $data->title = …;`처럼 DB에 가지 않는 객체는
  바로 위에서 대입한 필드조차 완성되지 않습니다.
- 추론은 **한 파일 안**만 봅니다. `include`로 들어온 변수는 대상이 아닙니다.
- 구조 분해(`[$a, $b] = …`)·복합 대입(`+=`, `??=`)·참조 대입(`=&`)은 캡처하지 않아 이전 바인딩이
  남습니다. 오탐이 생기면 `@var`로 정확한 테이블을 적거나 진단을 끄면 됩니다.
- 팩트가 하나도 없는 빈 클로저는 완성의 스코프 축소에 보이지 않아 바깥 스코프로 폴백합니다.

## 5. 언어 문자열 인텔리전스

**인식하는 호출 형태** — 함수 `get_string`·`print_string`·`print_error`,
생성 `new moodle_exception`·`new lang_string`·`new help_icon`.

**컴포넌트 생략 규칙** — Moodle 규칙을 그대로 따릅니다. 컴포넌트를 생략하거나 `moodle`·`core`를
적으면 `get_string('ok')` → core, `new moodle_exception('code')` → `error`로 갑니다.

**컴포넌트 전파** — 컴포넌트가 리터럴이 아닌 호출도 해석합니다. 변수·`$this->프로퍼티`·클래스 상수를
**같은 파일 안의 문자열 리터럴까지 거슬러 올라가** 확정합니다.

**제공 기능**

- **완성** — `get_string('|', 'local_x')`의 키 자리에서 그 컴포넌트의 키 목록과 **한국어 값
  미리보기**를 보여 줍니다.
- **F12** — `lang/ko`·`lang/en`의 `$string['key']` 줄로 이동합니다. 둘 다 있으면 피커가 뜹니다.
- **Hover** — 한국어 값과 영어 값을 함께 보여 주고, 아래에 **"사용 N건 보기"** 링크가 붙습니다.
- **참조(Shift+F12)** — **양방향**입니다. 코드의 키 위에서도, lang 파일의 `$string` 줄에서도
  사용처 목록이 열립니다. PHP·JS·mustache 호출처를 모두 포함합니다.
- **CodeLens** — lang 파일의 `$string['key']` **줄마다** "사용 N건" 버튼
  (`csmscode.strings.codeLens`).
- **하이라이트** — 해석되는 키를 링크 색상으로 표시합니다 (`csmscode.strings.highlightResolved`).
- **진단 + QuickFix** — 색인에 있는 컴포넌트인데 키가 없으면 경고하고 가까운 키를 제안합니다.
  진단 code는 `csms.string.<제안>`입니다. 색인에 없는 컴포넌트는 근거가 없으므로 침묵합니다.

**적용 범위** — `lang/en`과 `lang/ko`만 색인합니다. 컴포넌트가 문자열 보간(`"block_{$b->name}"`)·
연결(`'mod_' . $type`)·함수 반환값에서 오는 호출은 해석하지 않습니다.

## 6. Mustache 템플릿 인텔리전스

### PHP → 템플릿

`render_from_template('component/name', …)`의 첫 인자에서 **F12**로 `.mustache` 파일로
이동합니다. 테마 오버라이드가 있으면 원본과 오버라이드를 함께 보여 줍니다.
해석되는 참조는 링크 색상으로 표시됩니다 (`csmscode.templates.highlightResolved`).

### 템플릿 → 사용처

`.mustache` 파일에서 **Shift+F12**로 그 템플릿을 쓰는 곳을 모두 찾습니다 — PHP의
`render_from_template`, JS의 `Templates.render`, **다른 mustache의 partial·parent 참조**.
파일 전체가 하나의 대상이므로 **맨 위에 "사용 N건" 버튼 하나**가 붙습니다
(`csmscode.templates.codeLens`). 테마 오버라이드 파일에서 물어도 같은 목록입니다.

### `.mustache` 파일 내부

- **partial `{{> comp/name}}` · parent `{{< comp/name}}`** — F12로 그 템플릿 파일로 이동
  (테마 오버라이드 함께).
- **`{{#str}}key, component{{/str}}` · `{{#cleanstr}}`** — F12로 lang 파일로 이동, hover로
  한국어 값 확인, hover 아래 "사용 N건 보기" 링크. 여러 줄로 쓴 형태도 인식하고, 인자가 변수면
  매칭되지 않습니다.
- 해석되는 참조만 링크 색상으로 표시됩니다.

**적용 범위** — `.mustache`에는 **누락 키 진단이 없습니다**. `{{#pix}}`·`{{#js}}`·`{{#userdate}}`와
`{{$block}}` 구조, mustache 변수와 PHP 컨텍스트의 연결도 대상이 아닙니다.

## 7. AMD 모듈 참조

`$PAGE->requires->js_call_amd('local_ubion/user', 'index')`의 첫 인자를 모듈 파일로 잇습니다.

- **F12** — `local_ubion/user` → `local/ubion/amd/src/user.js`. 중첩 경로(`local_x/foo/bar`)와
  코어 서브시스템(`core_form/submit` → `lib/form/amd/src/submit.js`)도 해석합니다.
- **Shift+F12** — `amd/src`의 모듈 파일에서 그 모듈을 부르는 `js_call_amd` 호출처 목록.
- **CodeLens** — 모듈 파일 **맨 위에 "사용 N건" 버튼** (`csmscode.amd.codeLens`).
- **하이라이트** — 해석되는 참조에 링크 색상 (`csmscode.amd.highlightResolved`).

**적용 범위** — `amd/build`의 미니파이 사본과 `.min.js`는 생성물이라 색인하지 않으므로 그쪽으로는
이동하지 않습니다. 실제로 존재하지 않는 모듈, 겹따옴표 리터럴, `lib/components.json`이 없는
구버전의 코어 서브시스템 모듈은 해석되지 않고 조용히 아무 일도 하지 않습니다.

## 8. SQL·DML 테이블 참조

**코드 → 선언** — 다음 두 자리에서 **F12**로 그 테이블을 선언한 `install.xml`의 `<TABLE>` 줄로
이동합니다.

- SQL 문자열 안의 `{tablename}` — 단일 인용·이중 인용·heredoc·nowdoc 모두. 이중 인용의
  `{$var}` 보간은 별도 노드로 쪼개지므로 테이블로 오인하지 않습니다.
- `$DB->` 메서드의 **첫 문자열 인자** — `update_record`·`insert_record`·`get_record` 등.
  `sql_` 접두 메서드(`sql_like`·`sql_compare_text` 등)는 첫 인자가 컬럼·식이라 제외합니다.

**선언 → 사용처** — `install.xml`의 `<TABLE>` 줄에서 **Shift+F12**나 **"사용 N건" 버튼**
(`csmscode.tables.codeLens`)으로 그 테이블을 쓰는 SQL·`$DB` 호출을 모두 찾습니다.
대상은 **테이블 이름뿐이고 컬럼은 범위 밖**입니다.

**해석되는 참조만 반응합니다** — 색인에 있는 이름만 링크 색상이 붙고
(`csmscode.tables.highlightResolved`) 이동합니다. 정규식 수량자 `{4}`, 다른 템플릿 문법
`{Bucket}` 같은 비테이블 중괄호에는 아무 일도 일어나지 않습니다.

**적용 범위** — 문자열 안의 `{이름}`을 모두 후보로 보므로, `index.php?id={course}`처럼 테이블과
같은 이름이 든 비SQL 문자열에도 링크 색상이 붙을 수 있습니다(F12는 무해).

## 9. 플러그인 설정 키

`get_config('local_x', 'key')`와 `set_config('key', $v, 'local_x')`(인자 자리가 다릅니다)의 키를
`settings.php`의 `admin_setting_*` 선언과 잇습니다.

- **F12** — `settings.php`의 선언 줄로 이동합니다. `$name = $pluginname . '/key';` 같은 관용구를
  따라가고, `$v = 'p/k'`·`$v = $u . '/k'`·`"$u/k"` 형태도 인식합니다.
- **Hover** — 설정 클래스와 선언 위치(루트 기준 상대 경로), 아래에 "사용 N건 보기" 링크.
- **완성** — `get_config('local_x', '|')`의 키 자리에서 그 플러그인의 선언된 키 목록.
- **참조(Shift+F12)** — 코드 ↔ 선언 **양방향**.
- **CodeLens** — `settings.php`·`admin/settings/*.php`의 선언 줄 위에 "사용 N건" 버튼
  (`csmscode.config.codeLens`).
- **하이라이트** — 해석되는 키에 링크 색상 (`csmscode.config.highlightResolved`).

**플러그인 이름은 저장 키 그대로 비교합니다** — `ubboard`와 `mod_ubboard`는 서로 다른 설정입니다.
`$this->pluginname` 같은 동적 플러그인은 언어 문자열과 같은 전파로 해석합니다.
`settings.php`를 저장하면 선언 색인이 그 파일만 즉시 갱신됩니다.

**적용 범위** — **플러그인 설정만** 다룹니다. 코어 키(`get_config('core', …)`·
`set_config('k', $v)`·`$CFG->k`)의 참조, `$c = get_config('local_x'); $c->key` 통째 접근,
누락 키 진단(런타임에 `set_config`로만 만들어지는 키가 있어 오탐이 필연)은 대상이 아닙니다.
선언은 정규식으로 순차 스캔하므로 함수 스코프를 모릅니다 — 서브클래스 생성자의
`parent::__construct($name, …)`처럼 값이 매개변수인 변수, 함수 반환값·배열에서 오는 이름,
주석 처리된 선언은 잡지 않습니다.

## 10. Moodle 전역

`global $DB, $CFG, $USER;`로 가져온 전역에 완성·hover·F12를 제공합니다. `global` 선언 자체에는
타입 정보가 없으므로 Moodle 관례를 표로 둡니다.

| 전역 | 해석 | 멤버 출처 |
|---|---|---|
| `$DB` | `moodle_database` | 코어 클래스의 메서드·프로퍼티 |
| `$PAGE` | `moodle_page` | 코어 클래스 (매직 프로퍼티 포함) |
| `$OUTPUT` | `core_renderer` | 코어 클래스 (매직 프로퍼티 포함) |
| `$USER` | `user` 테이블 | install.xml 컬럼 |
| `$COURSE` | `course` 테이블 | install.xml 컬럼 |
| `$SITE` | `course` 테이블 | install.xml 컬럼 |
| `$CFG` | 설정 | `config-dist.php` + `settings.php` 선언 |

- **완성** — 메서드는 인자 시그니처와 함께 뜹니다. `$DB->`는 멤버가 100개를 넘으므로 실코드에서
  자주 쓰는 것(`get_record`·`get_records`·`get_records_sql`·`insert_record`·`update_record` 등)을
  위로 올립니다.
- **F12** — 코어 클래스 멤버는 그 클래스의 선언 줄로, `$CFG->` 키는 `config-dist.php` 또는
  선언한 `settings.php`로 이동합니다.
- **Hover** — 멤버 종류와 설명. `$USER->`·`$COURSE->`·`$SITE->`는 컬럼의 한국어 설명입니다.

**전역에는 진단이 붙지 않습니다** — `$USER->ubion` 같은 런타임 필드에 경고를 띄우지 않습니다.
전역이 지역 변수로 가려지면(`foreach ($rows as $USER)`) 레코드 컬럼 추론(§4)이 담당합니다.
함수·클래스 밖 최상위에서도 동작합니다.

## 11. JS/AMD 소스 인텔리전스

`amd/src`의 JavaScript에서 문자열 리터럴을 PHP 쪽과 같은 대상으로 잇습니다.

- **`get_string` · `getString`** — `M.util.get_string`, `core/str` 모듈 방식, 구조 분해한
  `getString` 모두 수신자와 무관하게 인식합니다. F12로 lang 파일로 이동, hover로 한국어 값 확인,
  하이라이트, hover 아래 "사용 N건 보기" 링크.
- **`Templates.render` · `renderForPromise`** — 참조에 `/`가 있는 리터럴만 대상으로 삼아
  일반 `render()` 호출을 걸러냅니다. F12로 `.mustache`로 이동.
- lang 파일·템플릿 파일의 참조 목록에 이 JS 호출처가 함께 나옵니다.

**적용 범위** — JS는 AST 대신 정규식으로 읽으므로 주석·문자열 안의 호출도 잡힙니다. 진단이 아니라
이동·hover·참조 용도라 침묵 방향으로 안전합니다. `amd/build`·`.min.js`는 색인하지 않습니다.

---

## 12. 사용처 색인 (Shift+F12 · "사용 N건"의 근거)

참조 목록과 CodeLens 개수는 모두 하나의 사용처 색인에서 나옵니다. 루트 전체의 PHP·JS·mustache에서
언어 문자열·템플릿·AMD 모듈·설정 키·테이블 참조를 추출합니다.

**생성 시점** — 활성화가 아니라 **첫 요청**입니다. Shift+F12를 누르거나 CodeLens 버튼을
클릭하면 그때 만들고, 만드는 동안 진행률 알림이 뜹니다. 색인이 없는 상태에서 개수를 묻는 것만으로는
빌드가 시작되지 않습니다. 색인이 아직 없으면 CodeLens 라벨은
"사용 찾기"로 보이고, 클릭이 곧 색인 요청입니다. 0건도 "사용 0건"으로 적습니다 — 비우면
색인이 안 된 상태와 구별되지 않습니다.

**디스크 캐시** (`csmscode.usageIndex.cache`, 기본 켜짐) — 만든 색인을 워크스페이스당 약 1MB로
전역 저장소에 저장해 다음 세션에 **알림 없이 즉시** 불러옵니다. 불러온 직후 잠깐은 마지막 세션
기준이고, 백그라운드에서 파일의 mtime·크기를 비교해 바뀐 파일만 다시 읽은 뒤 맞춰집니다.
읽을 수 없는 캐시는 버리고 전체 스캔으로 내려갑니다. 끄면 매번 전체 스캔합니다.

**증분 갱신** — 사용처 파일에서 호출을 추가·삭제하고 저장하면 참조 목록에 반영됩니다.

**한계와 대응** — 파일 내용을 읽지 않고 mtime·크기만 보므로 **둘이 그대로인 변경은 놓칩니다**
(`rsync -t`·`tar` 복원, mtime 해상도가 1초인 파일시스템에서 같은 초에 두 번 편집).
명령 팔레트의 **"CSMS Code: 사용처 색인 다시 만들기"**로 다시 만들 수 있습니다.
색인은 정규식 기반이라 **리터럴 컴포넌트만** 봅니다 — 컴포넌트가 동적인 `get_string`과 플러그인이
동적인 `get_config`는 F12·hover·하이라이트·진단은 되지만 **사용처 목록과 "사용 N건" 개수에는
나타나지 않습니다.** 색인 하나는 창(확장 호스트)마다 별개입니다.

## 13. 공통 장치

**출처 표시** — 자동완성 항목의 오른쪽 끝과 hover 아래에 `csms-intelli` 표시가 붙습니다.
다른 PHP 확장이 준 결과와 구분하기 위한 것이고, `csmscode.showSourceLabel`로 끌 수 있습니다
(기능은 그대로 남습니다).

**상태 표시줄** — 화면 왼쪽 아래에 `csms-intelli`와 색인된 테이블 수가 계속 표시됩니다.
색인 중에는 회전 아이콘, 실패하면 오류 아이콘으로 바뀝니다. 마우스를 올리면 Moodle 루트 경로와
테이블·언어 문자열·템플릿·AMD 모듈 색인 수가 나옵니다. `csmscode.showSourceLabel`과 무관하게
항상 표시됩니다 — 확장이 살아 있는지 확인하는 수단입니다.

**해석 하이라이팅** — 해석되는 참조를 링크 색상(`textLink.foreground`)으로 표시합니다.
색이 붙었다는 것은 곧 F12가 동작한다는 뜻이므로, 눌러 보지 않고도 죽은 참조를 알아볼 수 있습니다.
문자열·템플릿·테이블·AMD·설정 다섯 종류를 각각 독립적으로 끌 수 있습니다.

**진단** — 두 종류뿐입니다. 컬럼 오타(`csms.column.<제안>`)와 언어 문자열 누락 키
(`csms.string.<제안>`). 둘 다 Problems 패널에 출처 `csms-intelli`로 뜨고, 전구(QuickFix)로
제안 값으로 고칠 수 있습니다. 근거가 없는 대상(색인에 없는 컴포넌트·테이블)에는 경고하지 않습니다.

**PHP 단어 경계** (`csmscode.php.selectDollarInWord`, 기본 켜짐) — PHP에서 `$`를 단어의 일부로
봅니다. 더블클릭·Ctrl+D가 `$config`를 통째로 선택합니다(기본 동작은 `config`만).
`$config->courseid`의 `courseid`는 그대로 `courseid`만 선택됩니다. 설정을 끄면 창 재시작 없이
기본 동작으로 돌아갑니다. 다른 PHP 확장이 같은 설정을 덮어쓰면 그쪽이 이길 수 있습니다.

**파싱** — PHP는 tree-sitter로 파싱하고, 같은 문서 텍스트에 대한 팩트는 캐시해 완성·hover·정의·
진단이 재파싱을 공유합니다. 파싱에 실패한 파일은 팩트 없음으로 떨어져 그 파일의 인텔리전스만
조용히 침묵하고, 파서 상태를 버려 다음 문서는 영향받지 않습니다. 1MB를 넘는 파일도 같은
처리를 합니다. `.mustache`와 JavaScript는 정규식으로 읽습니다.

**심볼릭 링크** — 심볼릭 링크된 플러그인 디렉터리도 초기 색인에 포함하고, 깨진 링크는 조용히
제외합니다. 다만 파일 워처는 링크 내부의 변경을 감지하지 못할 수 있어, 링크된 플러그인의
`install.xml`을 고친 뒤에는 창 재시작이 필요할 수 있습니다.

## 14. 명령

| 명령 | 하는 일 |
|---|---|
| `CSMS Code: 사용처 색인 다시 만들기` | 사용처 색인을 캐시·도장 비교와 무관하게 전체 재생성하고 디스크 캐시를 갱신합니다. |

내부 명령(`csmscode.showStringReferences` 등 다섯 개)은 CodeLens 버튼과 hover 링크가 부르는
것으로, 명령 팔레트에 노출되지 않습니다.

## 15. 설정

| 설정 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `csmscode.detectInSubfolders` | `string[]` | `["moodle"]` | Moodle 루트가 하위 폴더에 있을 때 탐색할 폴더명 목록 |
| `csmscode.diagnostics.enable` | `boolean` | `true` | DB 레코드 컬럼 오타 진단 |
| `csmscode.showSourceLabel` | `boolean` | `true` | 자동완성·hover에 `csms-intelli` 출처 표시 (상태 표시줄은 무관) |
| `csmscode.php.selectDollarInWord` | `boolean` | `true` | PHP에서 `$`를 단어의 일부로 취급 |
| `csmscode.usageIndex.cache` | `boolean` | `true` | 사용처 색인을 디스크에 저장 (워크스페이스당 약 1MB) |
| `csmscode.strings.highlightResolved` | `boolean` | `true` | 해석되는 `get_string` 키 하이라이팅 |
| `csmscode.strings.codeLens` | `boolean` | `true` | lang 파일 `$string['key']` 줄 위 "사용 N건" 버튼 |
| `csmscode.templates.highlightResolved` | `boolean` | `true` | 해석되는 템플릿 참조 하이라이팅 |
| `csmscode.templates.codeLens` | `boolean` | `true` | mustache 파일 맨 위 "사용 N건" 버튼 |
| `csmscode.amd.highlightResolved` | `boolean` | `true` | 해석되는 AMD 모듈 참조 하이라이팅 |
| `csmscode.amd.codeLens` | `boolean` | `true` | `amd/src` 모듈 파일 맨 위 "사용 N건" 버튼 |
| `csmscode.tables.highlightResolved` | `boolean` | `true` | 해석되는 테이블 참조(`{table}`) 하이라이팅 |
| `csmscode.tables.codeLens` | `boolean` | `true` | `install.xml` `<TABLE>` 줄 위 "사용 N건" 버튼 |
| `csmscode.config.highlightResolved` | `boolean` | `true` | 해석되는 `get_config`·`set_config` 키 하이라이팅 |
| `csmscode.config.codeLens` | `boolean` | `true` | `settings.php` `admin_setting` 선언 줄 위 "사용 N건" 버튼 |

## 16. 비목표

- PHPStorm 지원
- 완전한 PHP 타입 추론 / 파일을 넘는 전역 데이터플로우
- Moodle 코어 자체 수정, 린터·포매터 대체
