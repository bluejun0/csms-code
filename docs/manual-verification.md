# 수동 검증 (실제 저장소에서 확인할 체크리스트)

1. `npm run package` → `csms-code-<package.json의 version>.vsix` 생성 확인
2. code --install-extension csms-code-<version>.vsix
3. ~/workspace/hlulxp 열기
4. local/ubattend 의 아무 php에서:
   - $config = $DB->get_record('local_ubattend_config', ...); 아래 줄에서 `$config->` 입력 → 컬럼 목록 + 한국어 설명 표시
   - 존재하지 않는 컬럼(예: $config->coursid) → 노란 경고 + quick fix 'courseid'
   - 컬럼에 F12(정의로 이동) → install.xml 해당 FIELD 줄로 점프
   - 컬럼에 hover → 'table.column  int  강좌 고유번호'
   - foreach ($rows as $r) 에서 $r-> (get_records 대상) 컬럼 완성
   - $data = new stdClass(); ... insert_record('local_ubattend_config', $data) 위에서 $data-> 완성
5. 설정 csmscode.diagnostics.enable=false → 진단 사라짐 확인
6. 대형 php 파일에서 빠르게 타이핑 → 타이핑 중에는 진단이 갱신되지 않다가 멈춘 뒤 ~0.3초 후 갱신 (debounce)
7. 오타 컬럼이 있는 문서를 닫았다가 다시 열기 → 열자마자(지연 없이) 진단 표시, 닫힌 동안 진단 목록에 남지 않음
8. get_string('', 'local_ubattend')의 첫 인자 따옴표 안에서 입력 → 키 목록 + 한국어 값 미리보기
9. 존재하는 키 위에서 F12 → lang/ko·lang/en 파일의 $string 줄로 이동(둘 다 있으면 피커), hover → 한국어+영어 값
10. 존재하지 않는 키(예: get_string('attendance_bok', 'local_ubattend')) → 경고 + 가까운 키 제안. 색인에 없는 컴포넌트는 경고 없음 확인
11. lang/ko/local_ubattend.php의 $string['attendance_book'] 줄에서 Shift+F12 → 사용처 목록(첫 요청 시 진행률 알림 ~20초, 이후 즉시)
12. 사용처 파일에서 get_string 호출 추가/삭제 후 저장 → 참조 목록에 반영(증분)
13. 해석되는 get_string 키가 링크 색상으로 표시되고, csmscode.strings.highlightResolved=false 설정 시 사라짐
14. `$OUTPUT->render_from_template('local_ubattend/setting', …)`의 첫 인자 위에서 F12 → 해당 .mustache 파일로 이동(theme에 오버라이드가 있으면 두 위치가 함께 표시)
15. .mustache 파일 안에서 Shift+F12 → 그 템플릿을 쓰는 render_from_template 호출 목록(첫 요청 시 진행률, 이후 즉시)
16. 존재하는 템플릿 참조가 링크 색상으로 표시되고, csmscode.templates.highlightResolved=false 시 사라짐
17. blocks/ 플러그인(예: block_html)의 컬럼 완성·문자열 기능이 동작 — 이전에는 blocks 디렉터리가 색인되지 않았음
18. VS Code로 폴더만 열고(PHP 파일은 열지 않은 채) .mustache 파일을 먼저 연 뒤 Shift+F12 → 사용처 목록이 뜸(활성화 이벤트 검증 — 이전에는 조용히 무동작)
19. `local/*/amd/src/*.js`에서 `M.util.get_string('key','local_x')`의 키 위에 F12 → lang 파일로 이동, hover → 한국어 값
20. 같은 파일에서 `Templates.render('local_x/name')`의 리터럴에 F12 → .mustache로 이동
21. lang 파일에서 Shift+F12 → PHP 호출처와 함께 JS 호출처도 목록에 나타남(단, `amd/build`의 미니파이 사본은 나타나지 않아야 함)
22. 워크스페이스를 처음 열 때 편집이 멈추지 않고, 상태바에 "CSMS Code: 색인 중…"이 잠깐 보인 뒤 사라짐(색인 완료 후 진단·하이라이트가 자동으로 채워짐)
23. lang 파일의 값을 고쳐 저장 → hover/완성에 즉시 반영되고 저장이 체감상 멈추지 않음(전체 재색인이 아니라 그 파일만 갱신)
24. install.xml에 FIELD를 추가해 저장 → 해당 테이블 컬럼 완성에 즉시 반영. .mustache 파일을 새로 만들면 그 참조가 바로 해석됨(하이라이트 색이 붙음)
25. SQL 문자열의 테이블 참조에서 F12 → install.xml의 `<TABLE>` 줄로 이동. 세 가지 인용 방식 각각 확인:
    - `$DB->get_records_sql('SELECT * FROM {course} …')` — 단일 인용
    - `"… FROM {user} u JOIN {course_modules} cm …"` — 이중 인용(보간 `{$id}`가 섞여 있어도 테이블만 인식)
    - `<<<SQL … FROM {grade_items} … SQL;` — heredoc(여러 줄에서도 커서 위치가 맞아야 함)
26. 해석되는 테이블 참조가 링크 색상으로 표시되고, `csmscode.tables.highlightResolved=false` 시 사라짐
27. 테이블이 아닌 중괄호에는 아무 일도 일어나지 않음 — `preg_match('/[0-9]{4}/')`, `'{Bucket}'` 등에 하이라이트·이동·경고 없음
28. Moodle이 `moodle/` 하위에 있는 워크스페이스(예: ~/workspace/csms39)를 설정 변경 없이 열기 → 컬럼·문자열 기능이 바로 동작(기본 설정에 `moodle` 포함)
29. 16진 이스케이프가 있는 파일(예: `mod/zoom/jwt/JWT.php`)을 연 뒤 **다른 정상 파일**로 이동 → 정상 파일의 완성·진단이 온전히 동작(파싱 실패가 다음 문서를 오염시키지 않음)
30. `$PAGE->requires->js_call_amd('local_ubion/user', 'index')`의 첫 인자에서 F12 → `local/ubion/amd/src/user.js`로 이동. 중첩 경로(`local_manager/code/index`)와 코어 서브시스템(`core_form/submit` → `lib/form/amd/src/submit.js`)도 확인
31. `amd/src`의 .js 파일에서 Shift+F12 → 그 모듈을 부르는 `js_call_amd` 호출처 목록(첫 요청 시 진행률, 이후 즉시)
32. 없는 모듈(`local_ubion/asiteHaksa`)에는 이동·하이라이트 없음. 해석되는 참조는 링크 색상이고 `csmscode.amd.highlightResolved=false`로 사라짐
33. `amd/src`에 .js를 새로 만들고 그 이름으로 `js_call_amd`를 쓰면 바로 해석됨(워처 증분). `amd/build`의 미니파이 사본으로는 이동하지 않음
34. 서브플러그인에서 기능이 동작하는지 — `mod/quiz/accessrule/seb`(quizaccess)·`question/bank/*`(qbank)·`lib/editor/tiny/plugins/*`(tiny)의 PHP에서 `get_string` 완성·컬럼 완성이 되고, 그 lang 파일에서 Shift+F12가 사용처를 찾는지
35. 플러그인에 `db/subplugins.json`을 새로 만들거나 고친 뒤 저장 → 상태바에 재색인이 뜨고 새 타입의 플러그인이 바로 인식됨
36. `global $DB;` 아래에서 `$DB->get_rec` 입력 → `get_record`·`get_records`가 인자 시그니처와 함께 뜨고(자주 쓰는 것이 위), F12가 `lib/dml/moodle_database.php`의 선언 줄로 이동. 첫 요청은 색인을 만드느라 잠깐 걸리고 이후는 즉시
37. `$PAGE->cont` → `context`(매직 프로퍼티)가 뜸. `$OUTPUT->head` → `header`
38. `$CFG->wwwr` → `wwwroot`가 설명과 함께 뜨고 F12가 `config-dist.php`로 이동
39. `$USER->` → user 테이블 컬럼이 한국어 설명과 함께 뜸. `foreach ($rows as $USER)` 안에서는 전역이 아니라 그 레코드의 컬럼이 뜨는지 확인
40. 전역 어디에도 경고가 붙지 않음(`$USER->ubion` 같은 런타임 필드에 진단 없음)
41. 함수·클래스 **밖**(최상위)에서도 전부 동작하는지 — Moodle 페이지 스크립트에서 `$DB->`·`$USER->`·`$CFG->` 완성, `$config = $DB->get_record(...)` 뒤 `$config->` 컬럼 완성, `?>` HTML `<?php`로 끊긴 뒤에도 유지되는지
42. 상태 표시줄 왼쪽에 `csms-intelli`와 테이블 수가 보이고, 마우스를 올리면 루트 경로와 네 색인 수가 나옴. 워크스페이스를 열 때는 회전 아이콘이었다가 색인이 끝나면 숫자로 바뀜
43. 자동완성 목록의 각 항목 오른쪽 끝과 hover 아래에 `csms-intelli` 표시가 보임. `csmscode.showSourceLabel=false`로 끄면 표시만 사라지고 기능은 그대로
44. Problems 패널에서 진단 출처가 `csms-intelli`이고 코드가 종류에 맞는지 — 컬럼 오타는 `csms.column.<제안>`, 언어 문자열 오타는 `csms.string.<제안>`. 두 경우 모두 전구(QuickFix)로 제안 값으로 고쳐지는지
45. `.mustache` 안에서: `{{> theme_coursemos/foo}}`에 F12 → 그 파일로 이동, `{{#str}}attendance_book, local_ubattend{{/str}}`의 키에 F12 → lang 파일로, hover → 한국어 값. 해석되는 것만 링크 색상
46. 템플릿 파일에서 Shift+F12 → PHP·JS 호출처와 **다른 mustache의 partial 참조가 함께** 나옴. 테마 오버라이드 파일에서 물어도 같은 목록
47. `grade/templates/*.mustache`(코어 서브시스템)에서도 위가 동작 — 이전에는 컴포넌트 자체가 식별되지 않았음
48. `$DB->update_record('local_ubattend_config', $data)`의 테이블 인자에 F12 → install.xml `<TABLE>` 줄로 이동하고 링크 색상이 붙음. `$DB->sql_like('email', …)`처럼 SQL 조각 헬퍼의 첫 인자에는 아무 일도 없어야 함(컬럼 이름이라서)
49. PHP에서 `$config`를 더블클릭 → `$`까지 함께 선택됨. `$config->courseid`의 `courseid`를 더블클릭하면 `courseid`만. `csmscode.php.selectDollarInWord=false`로 끄면 기본 동작(`config`만)으로 돌아옴 — 창 재시작 없이
50. `$comp = 'local_ubattend'; get_string('attendance_book', $comp);` 에서 키에 F12·hover가 동작. `protected $pluginname = 'local_ubattend';` 를 쓰는 클래스의 `get_string('k', $this->pluginname)`도 동작
51. 같은 파일에서 그 변수에 서로 다른 리터럴을 두 번 대입하면 아무 반응도 없음(모호하면 침묵)
52. 겹따옴표(`$string['k'] = "값";`)와 연결(`'a' . $string['b']`)로 정의된 키에도 hover·F12가 되고 경고가 없음
53. 색인 규칙 밖 경로(예: `PLUGIN_DIRS`에 없는 플러그인 타입)의 install.xml·lang·.mustache를 저장 → 아무 일도 일어나지 않음(경고·재색인 없음). 그런 경로는 애초에 색인 대상이 아니다.
54. 코드의 `get_string('attendance_book', 'local_ubattend')` 키 위에서 Shift+F12 → 사용처 목록에 lang ko·en 정의가 함께 나옴(첫 요청 시 진행률 알림, 이후 즉시). 사용처가 하나뿐이고 lang 정의도 하나뿐이면 목록 대신 바로 그 사용처로 점프하는 것이 정상(VS Code의 참조 2건 축약). `amd/src` JS의 `getString(...)`·mustache의 `{{#str}}` 키 위에서도 같은 목록
55. `print_string('k', 'local_ubattend')`에서 완성·F12·hover·하이라이트·누락 키 경고·Shift+F12가 `get_string`과 똑같이 동작. `print_string('k', $this->pluginname)`도 F12·hover
56. lang/ko/local_ubattend.php를 열면 `$string[...]` 줄마다 위에 "사용 찾기"(색인 전) 버튼이 보임. 클릭 → 색인 진행률 후 그 자리에서 참조 peek이 열리고, 모든 버튼이 "사용 N건"으로 바뀜. 사용처 파일에서 호출을 추가·저장하면 개수가 갱신됨. `lang/en/moodle.php`(키 수천 개)를 열어도 스크롤이 버벅이지 않음
57. 코드 쪽 문자열 hover 맨 아래 "사용 N건 보기" 링크 클릭 → 같은 peek. 색인 전에는 "사용 찾기". 템플릿 hover에는 링크가 없음
58. `csmscode.strings.codeLens=false` → 버튼이 즉시 사라지고 Shift+F12·hover 링크는 그대로. `$string["key"]`(겹따옴표 키) 줄에서도 Shift+F12 동작
59. `throw new moodle_exception('nope')`(컴포넌트 없음) → `'core_error'에 'nope' 문자열이 없습니다` 경고. `error.php`에 있는 코드(`invalidcoursemodule`)는 경고 없이 F12가 `lang/en/error.php`로 이동. `new \moodle_exception(...)`·`print_error('nope', 'moodle')`도 같은 규칙
60. `print_error('k', 'local_ubattend')`·`new lang_string('k', 'local_ubattend')`·`new help_icon('k', 'local_ubattend')`에서 완성·F12·hover·하이라이트·Shift+F12가 `get_string`과 똑같이 동작하고, lang 파일의 "사용 N건"에 이 호출들이 포함됨
61. `get_string('ok')`(한 인자)에서 F12 → `lang/en/moodle.php`. `new moodle_exception('` 입력 시 `error.php` 키가 완성 목록에 뜨고, `get_string('` 뒤에 컴포넌트도 닫는 괄호도 없으면 목록이 뜨지 않음
62. `local/csmsmedia/lib.php`(또는 `get_config('local_csmsmedia', 'organization_code')`가 있는 파일)의 키 위에서 F12 → `local/csmsmedia/settings.php`의 `new admin_setting_configtext($name, …)` 줄로 이동(`$name = $pluginname . '/organization_code'` 관용구). 첫 요청은 선언 색인을 만드느라 잠깐 걸리고 이후 즉시. hover → `**local_csmsmedia / organization_code**`·`admin_setting_configtext`·`local/csmsmedia/settings.php:N`·아래 "사용 N건 보기"
63. 같은 키에서 Shift+F12 → `get_config`·`set_config` 호출처 + 선언이 함께 나옴. `settings.php`의 그 선언 줄에서 Shift+F12 → 호출처. `get_config($this->pluginname, 'k')`에서도 F12·hover가 되고, 그 호출은 목록·개수에는 없음(문자열과 같은 제한)
64. `local/csmsmedia/settings.php`를 열면 잠시 후 선언 줄마다 "사용 N건"(사용처 색인 전이면 "사용 찾기") 버튼. 클릭 → 그 자리에서 peek. `csmscode.config.codeLens=false`로 사라짐
65. `settings.php`에 `$name = $pluginname . '/newkey'; $settings->add(new admin_setting_configtext($name, …));`를 추가해 저장 → 코드의 `get_config('local_csmsmedia', 'newkey')`가 바로 링크 색상이 되고 F12가 됨(창 재시작 없이). `csmscode.config.highlightResolved=false`로 색이 사라짐
66. `get_config('local_csmsmedia', '` 입력 → 그 플러그인의 선언된 키 목록(설정 클래스가 detail). `get_config('mod_ubboard', 'k')`처럼 선언이 `ubboard/k`인 키에는 이동·색·완성이 없어야 함(플러그인 이름은 그대로 비교)
67. `.mustache` 파일을 열면 맨 위에 "사용 N건"(사용처 색인 전이면 "사용 찾기") 버튼 하나. 클릭 → 그 자리에서 Shift+F12와 같은 목록(PHP 호출·partial·JS). 테마 오버라이드 파일(`theme/coursemos/templates/local_x/…`)에서도 같은 목록. `csmscode.templates.codeLens=false`로 사라짐
68. `amd/src`의 .js 파일을 열면 맨 위에 "사용 N건"(색인 전 "사용 찾기") 버튼 하나. 클릭 → js_call_amd 호출처 peek. `amd/build`의 미니파이 사본에는 버튼이 없어야 함. `csmscode.amd.codeLens=false`로 사라짐
69. 사용처 색인 캐시: 처음 Shift+F12(또는 "사용 찾기" 클릭)는 진행률 알림과 함께 몇 초 걸린다. 창을 닫고 다시 열어 같은 워크스페이스에서 같은 동작 → **알림 없이 즉시** 결과가 나온다
70. 캐시 검증: 창을 닫은 상태에서 외부에서 파일을 고치거나 `git checkout`을 한 뒤 창을 열고 Shift+F12 → 즉시 결과가 뜨고, 몇 초 안에 바뀐 내용이 반영된다(버튼 개수·하이라이트가 갱신됨)
71. `csmscode.usageIndex.cache=false` → 창을 다시 열면 다시 전체 스캔(진행률 알림)한다. 확장을 새 버전으로 올린 직후에도 한 번은 전체 스캔한다(옛 캐시를 버림)
72. 명령 팔레트에서 "CSMS Code: 사용처 색인 다시 만들기" → 진행률 알림과 함께 전량 재스캔하고, 끝나면 버튼 개수·하이라이트가 갱신되며 캐시도 다시 쓰인다(mtime이 보존된 변경을 놓쳤을 때의 회복 수단)
73. 심볼릭 링크로 플러그인을 트리 **안**에 붙인 경우(`local/foo -> plugins/foo`) 같은 호출이 목록에 두 번 나오지 않는다
74. **`install.xml`을 열어 둔 채로 창을 새로 열어** 확인한다(선언 색인이 비동기라 이 순서가 중요하다). `local/ubattend/db/install.xml`의 `<TABLE NAME="local_ubattend_config">` 줄에서 Shift+F12 → 그 테이블을 쓰는 SQL `{local_ubattend_config}`과 `$DB->` 호출이 모두 나온다. 그 줄 위 "사용 N건" 버튼도 같은 목록을 연다. `<FIELD>` 줄에서는 아무 일도 없어야 함(테이블 이름만)
75. `install.xml`에 `<TABLE>`을 새로 추가해 저장 → 그 줄에 버튼이 바로 붙고, 이미 그 이름을 쓰는 SQL이 있으면 개수가 잡힌다. `csmscode.tables.codeLens=false`로 버튼이 사라진다

## 알려진 제한 (Known limitations)

추론은 한 파일 안의 로컬 데이터플로우만 추적합니다 — 함수·메서드·클로저 안과 최상위 스크립트 모두에서
동작하고(`?>` HTML `<?php`로 끊겨도), 파일을 넘는 추론은 하지 않습니다. 단순 변수 재대입은
kill-on-reassign(2026-07-31)으로 추적되지만, 구조 분해(`[$a,$b] = …`)·복합(`+=`, `??=`)·
참조(`=&`) 대입은 캡처되지 않아 이전 바인딩이 유지될 수 있습니다(낙관 동작).
오탐 시 `csmscode.diagnostics.enable`로 진단을 끄거나 해당 변수에 정확한 `@var`
주석을 달 수 있습니다.

문자열 색인은 홑따옴표·겹따옴표 값과 `.` 연결을 모두 읽습니다(연결 안의 비리터럴 조각은 `…`로 표시).
한 인자 호출(`get_string('ok')`)과 키가 쌍따옴표인 호출은 여전히 침묵합니다. 컴포넌트가 동적인 호출은
같은 파일의 리터럴로 해석되면 동작하지만, 문자열 보간·연결·함수 반환값에서 온 컴포넌트는 침묵합니다.
참조 색인은 저장된 파일 기준입니다(미저장 편집은 저장 시 반영). 변수 key/component 호출은
참조·하이라이팅 모두에서 포착되지 않습니다.

템플릿 색인은 플러그인·코어(`lib/templates`)·코어 서브시스템(`grade/templates` 등)·테마 경로 규칙을 따릅니다 —
동적 인자 호출은 침묵합니다. 홑따옴표와 겹따옴표 리터럴을 같게 인식하며, 보간이 섞인 문자열은
리터럴이 아니므로 침묵합니다.

AMD 모듈 참조는 `js_call_amd`의 문자열 리터럴을 인용 형태와 무관하게 인식합니다. 동적 인자는
침묵합니다. 코어 서브시스템 매핑은 `lib/components.json`에서 읽으므로 이 파일이 없는 구버전(3.5·2.9)에서는
`core_form/submit` 같은 코어 모듈만 해석되지 않습니다. 플러그인 타입 매핑은 Moodle 선언에서 읽으므로
`gradingform`·`assignfeedback`·`quizaccess` 같은 서브플러그인 타입도 해석됩니다(선언이 없는 3.5·2.9는
`subplugins.php`까지 읽고, 그래도 없으면 내장 폴백 맵을 씁니다). 실측 해석률은 추출된 338건 중 328건(97.0%)이고,
나머지는 위 미매핑 타입과 실제로 존재하지 않는 모듈(`mod_ubboard/ubboard` 등)입니다. 정규식으로 센 전체 호출은 354건인데,
차이는 주석 처리된 호출입니다(AST 기준이라 주석은 제외됨 — 다만 사용처 목록(Shift+F12)은
정규식 스캔이라 주석 처리된 호출도 나타납니다).

SQL 테이블 참조는 문자열 안의 `{이름}` 형태를 모두 후보로 보고, install.xml에 있는 이름만 반응합니다 —
정규식 수량자(`{4}`)나 다른 템플릿 문법(`{Bucket}`)은 조용히 무시되지만, 반대로 SQL이 아닌 문자열에
테이블과 같은 이름이 들어 있으면(`index.php?id={course}`) 링크 색상이 붙을 수 있습니다. 실측으로
문자열 내 `{이름}` 7,585건 중 테이블로 해석되는 것은 57.8%이고, 나머지는 SQL이 아니어서 진단은 제공하지
않습니다. SQL 키워드 문맥 검사는 넣지 않았습니다 — 해석된 참조 중 280건이 조각 SQL(`, {groups_members} gm`)이라
문맥 검사가 정상 참조를 잘라내는 쪽이 더 큽니다.

`"\x00"` 같은 16진 이스케이프가 있는 파일은 이 tree-sitter 조합에서 파싱이 실패해 그 파일의 인텔리전스가
전부 침묵합니다(파서 상태는 즉시 리셋해 다음 파일에 영향을 주지 않습니다). hlulxp 실측 16개 파일로,
전부 vendor·번들 라이브러리입니다.

JS/AMD는 AST가 아닌 정규식으로 인식하므로 주석이나 문자열 안의 호출도 이동·hover 대상이 될 수 있습니다
(그래서 JS에는 진단을 제공하지 않습니다). `getStrings([...])` 배열 형태와 TypeScript 소스는 지원하지 않습니다. 컴포넌트를 생략한 한 인자 호출
(`getString('ok')` — core로 해석되는 형태)도 JS에서는 인식하지 않습니다(실측 39건, PHP에서는 인식됨).
