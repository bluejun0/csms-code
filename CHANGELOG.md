# 변경 이력

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르고,
버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다(1.0.0 이전이므로 MINOR가 기능 추가·동작 변경, PATCH가 수정입니다).

## 버전 정책

- **MINOR(0.x.0)**: 새 기능 표면 추가, 사용자에게 보이는 동작 변경, 성능 특성 변경.
- **PATCH(0.0.x)**: 버그 수정, 또는 배포물(README·설정 설명)에 영향 있는 변경.
- **버전 유지**: 개발 문서만 바뀔 때(`docs/` 백로그·스펙·계획, 테스트 추가) — 사용자가 받는 것이 달라지지 않으므로 올리지 않습니다.
- 각 개발 사이클(설계 → 계획 → 구현 → 리뷰)이 끝나 `main`에 병합될 때 **같은 사이클 안에서** 버전을 올리고 이 파일에 항목을 추가합니다. 병합 후 별도 커밋으로 미루지 않습니다.

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
