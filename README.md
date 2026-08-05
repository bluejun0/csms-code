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
- **타입 추론 범위**: 현재 함수/메서드 스코프 내 지역 변수의 가장 가까운 선행 대입만 추적합니다
  (전역 데이터플로우·크로스 함수 추론은 범위 밖).
- **워크스페이스 자동 인식**: Moodle 루트와 core + 커스텀 플러그인을 자동으로 찾아 색인하며,
  파일 변경을 감지해 증분 갱신합니다.
- **언어 문자열 인텔리전스**: `get_string('key', 'component')` 키 자동완성(한국어 값 미리보기)·정의로 이동(ko/en)·hover·누락 키 진단·해석 키 하이라이팅, lang 파일에서 사용처 참조 이동(Shift+F12)
- **Mustache 템플릿 인텔리전스**: `render_from_template('component/name', …)`에서 `.mustache` 파일로 이동(테마 오버라이드가 있으면 함께 표시)·템플릿 파일에서 사용처 참조 이동(Shift+F12)·해석되는 참조 하이라이팅
- **JS/AMD 인텔리전스**: `amd/src`의 `get_string`(`M.util.`·`core/str` 모두)·`Templates.render` 리터럴에 정의 이동·hover·하이라이팅, lang/템플릿 참조 목록에 JS 호출처 포함 (`amd/build`·`.min.js`는 생성물이라 제외)

## 설정

| 설정 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `csmscode.detectInSubfolders` | `string[]` | `[]` | Moodle 루트가 워크스페이스 하위 폴더에 있을 때 탐색할 폴더명 목록 (예: `["moodle"]`). |
| `csmscode.diagnostics.enable` | `boolean` | `true` | DB 레코드 컬럼 오타 진단을 켭니다. `false`로 설정하면 진단이 즉시 사라집니다. |
| `csmscode.strings.highlightResolved` | `boolean` | `true` | 해석되는 get_string 키를 링크 색상으로 하이라이팅 |
| `csmscode.templates.highlightResolved` | `boolean` | `true` | 해석되는 render_from_template 참조를 링크 색상으로 하이라이팅 |

## 개발

```bash
npm install
npm run compile        # tsc -noEmit + esbuild
npm run test:unit       # 단위 테스트 (mocha)
npm run lint            # eslint
npm run package         # esbuild(production) + vsce package → csms-code-0.1.0.vsix
```

수동 검증 절차는 [docs/manual-verification.md](docs/manual-verification.md)를 참고하세요.

## 알려진 제한 (Known limitations)

추론은 현재 함수 스코프 내 로컬 데이터플로우만 추적하며, 레코드 대입 후 같은 변수를
다른 값으로 재대입(예: `$rec = build_row();`)하는 경우 그 재대입을 추적하지 못해
이전 테이블 바인딩이 남아 드물게 정상 코드에 오탐 경고가 날 수 있습니다. 이 경우
`csmscode.diagnostics.enable`로 진단을 끄거나 해당 변수에 정확한 `@var` 주석을 달 수
있습니다. (kill-on-reassign은 후속 단계 예정.)

## 비목표

- PHPStorm 지원
- 완전한 PHP 타입 추론 / 전역 데이터플로우
- Moodle 코어 자체 수정, 린터/포매터 대체
