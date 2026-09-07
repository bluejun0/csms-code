# CSMS Code

CSMS/Moodle(코스모스, `*lxp`/`*lms` 계열) 개발을 위한 VSCode 확장입니다.  
여러가지 코드 분석 편의기능을 제공합니다.

## 설치

- 1. [Releases](https://github.com/bluejun0/csms-code/releases)에서 최신 `csms-code.vsix`를 내려받습니다.
- 2. vscode에서 `Ctrl + Shift + P` -> `Install from VSIX` 입력
- 3. 다운받은 `.vsix` 선택
- 4. 왼쪽 아래에  `csms-intelli` 표시 뜨면 설치 성공

## 주요 기능

- **1. DB 테이블 및 칼럼 참조**

  아래와 같은 구문에서 테이블이 정의된 위치로 이동할 수 있습니다. (`Ctrl + 클릭` 혹은 `F12`)

  ```php
  $DB->get_record('user_ubion', ...);
  $DB->insert_record('user_ubion', $data);
  "SELECT * FROM {user_ubion} WHERE id=:id"
  ```

  stdClass 객체 사용시 칼럼 인텔리전스 기능이 작동합니다.  
  칼럼 자동완성, 오타 경고 등을 지원합니다.

  ```php
  /** @var user_ubion $user **/
  $user-> // 입력시 칼럼 자동완성이 작동합니다
  $user = $DB->get_record('user_ubion', ...);
  $user->corseid // 경고, 존재하지 않는 칼럼
  ```

- **2. 언어팩 참조**

  아래와 같은 구문에서 lang 파일이 정의된 위치로 이동할 수 있습니다. (`Ctrl + 클릭` 혹은 `F12`)
  반대로 lang 파일에서 string 을 사용하는 위치로 이동할 수 있습니다 (`Shift + F12`)

  ```php
  get_string('hello', 'local_ubion')
  print_string('hello', 'local_ubion')
  print_error('hello', 'local_ubion')
  new moodle_exception('hello', 'local_ubion')
  new lang_string('hello', 'local_ubion')
  new help_icon('hello', 'local_ubion')
  ```

- **3. Mustache 템플릿 참조**

  아래와 같은 구문에서 mustache 템플릿 파일로 이동할 수 있습니다. (`Ctrl + 클릭` 혹은 `F12`)
  반대로 `.mustache` 파일에서 그 템플릿을 사용하는 위치로 이동할 수 있습니다. (`Shift + F12`)

  ```php
  $OUTPUT->render_from_template('local_ubion/user_list', $data);
  Templates.render('local_ubion/user_list', context);
  ```

  mustache 파일 안에서도 참조를 따라갈 수 있습니다.

  ```mustache
  {{> local_ubion/user_row}}
  {{< local_ubion/base}}
  {{#str}}hello, local_ubion{{/str}}
  {{#cleanstr}}hello, local_ubion{{/cleanstr}}
  ```

- **4. AMD/JS 참조**

  아래와 같은 구문에서 AMD JS 파일로 이동할 수 있습니다. (`Ctrl + 클릭` 혹은 `F12`)
  반대로 AMD JS 파일에서 그 AMD를 호출하는 위치로 이동할 수 있습니다. (`Shift + F12`)

  ```php
  $PAGE->requires->js_call_amd('local_ubion/user', 'index');
  // -> local/ubion/amd/src/user.js
  ```

- **5. 플러그인 설정 참조**

  아래와 같은 구문에서 `settings.php`의 선언 위치로 이동할 수 있습니다. (`Ctrl + 클릭` 혹은 `F12`)
  반대로 `settings.php` 선언에서 그 설정을 사용하는 위치로 이동할 수 있습니다. (`Shift + F12`)

  ```php
  get_config('local_ubencourage', 'used');
  get_config('used', 1, 'local_ubencourage');
  ```

  `$this->pluginname` 같은 동적 플러그인도 **일부** 지원합니다.

- **6. Moodle 전역 객체 인텔리전스**

  `$DB, $CFG, $USER` 등의 자동완성 및 참조 기능이 있습니다.