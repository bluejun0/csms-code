# 수동 검증 (실제 저장소에서 확인할 체크리스트)

1. `npm run package` → csms-code-0.1.0.vsix 생성 확인
2. code --install-extension csms-code-0.1.0.vsix
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
25. 색인 규칙 밖 경로(예: `PLUGIN_DIRS`에 없는 플러그인 타입)의 install.xml·lang·.mustache를 저장 → 아무 일도 일어나지 않음(경고·재색인 없음). 그런 경로는 애초에 색인 대상이 아니다.

## 알려진 제한 (Known limitations)

추론은 현재 함수 스코프 내 로컬 데이터플로우만 추적합니다. 단순 변수 재대입은
kill-on-reassign(2026-07-31)으로 추적되지만, 구조 분해(`[$a,$b] = …`)·복합(`+=`, `??=`)·
참조(`=&`) 대입은 캡처되지 않아 이전 바인딩이 유지될 수 있습니다(낙관 동작).
오탐 시 `csmscode.diagnostics.enable`로 진단을 끄거나 해당 변수에 정확한 `@var`
주석을 달 수 있습니다.

문자열 색인은 lang 파일의 단일 인용부호 관례(`$string['k'] = 'v';`)만 지원합니다 — 연결 연산·쌍따옴표
항목은 색인되지 않아 해당 키 사용처에 누락 경고가 뜰 수 있고(진단 off로 회피), 한 인자 호출
(`get_string('ok')`)과 쌍따옴표 호출은 인텔리전스가 침묵합니다.
참조 색인은 저장된 파일 기준입니다(미저장 편집은 저장 시 반영). 변수 key/component 호출은
참조·하이라이팅 모두에서 포착되지 않습니다.

템플릿 색인은 플러그인·코어(lib/templates)·테마 경로 규칙만 따릅니다 — 코어 서브시스템 템플릿
(`grade/templates` 등)과 JS의 `Templates.render()` 호출, 동적 인자 호출은 침묵합니다. 문자열과 마찬가지로 겹따옴표 리터럴(`render_from_template("a/b")`)은 정의 이동·하이라이팅에서
인식되지 않습니다(참조 목록에는 나타납니다 — 사용처 색인은 두 따옴표를 모두 훑습니다. 실측:
커스텀 코드에서 홑따옴표 444건 대 겹따옴표 1건).

JS/AMD는 AST가 아닌 정규식으로 인식하므로 주석이나 문자열 안의 호출도 이동·hover 대상이 될 수 있습니다
(그래서 JS에는 진단을 제공하지 않습니다). `getStrings([...])` 배열 형태와 TypeScript 소스는 지원하지 않습니다. 컴포넌트를 생략한 한 인자 호출
(`getString('ok')` — core로 해석되는 형태)도 JS에서는 인식하지 않습니다(실측 39건, PHP에서는 인식됨).
