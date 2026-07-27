# CSMS Code — Phase 2 백로그 & 알려진 제한

Phase 1 (DB stdClass 인텔리전스)은 완료되었습니다. 아래는 종합 리뷰에서 도출된 후속 작업과 배포 전 필수 게이트입니다.

## 배포 전 필수 (하드 게이트)
- **통합 테스트를 CI/xvfb에서 통과시킬 것.** `@vscode/test-electron` 통합 테스트는 이 개발 샌드박스(headless WSL2)에서 Electron이 크래시(SIGTRAP)해 실행되지 않았다. 정적 컴파일(`tsc -p tsconfig.test.json`)은 통과. 이 테스트는 WASM 번들(`dist/`) + `activate()` 결선을 검증하는 **유일한** 커버리지이므로, 실배포 전 반드시 CI(예: `xvfb-run`)에서 녹색 확인 필요.
- **`package.json`에 실제 사내 git repository URL 지정.** 현재 `repository` 필드는 제거된 상태(지어낸 URL 방지). `package` 스크립트는 `--allow-missing-repository`로 동작.

## 알려진 제한 (Phase 1)
- **재대입 미추적 → 드문 오탐**: 추론은 현재 함수 스코프의 로컬 데이터플로우만 추적한다. 레코드 대입 후 같은 변수를 다른 값으로 재대입(`$rec = build_row();`)하면 그 재대입을 추적하지 못해 이전 테이블 바인딩이 남아, 드물게 정상 코드에 "column not in table" 경고가 날 수 있다. 회피: `csmscode.diagnostics.enable=false` 또는 해당 변수에 정확한 `@var` 주석. 정식 해결은 아래 kill-on-reassign.

## Phase 2 후속 작업 (우선순위 순)
1. **kill-on-reassign 추론**: 팩트 레이어가 모든 LHS 변수 대입(레코드 메서드 외 `= new X()`, `= func()`, `= $other` 포함)을 캡처하고, 추론이 종류 무관 "가장 가까운 선행 대입"을 존중하도록. → 위 오탐 제거.
2. **진단 debounce + 파싱 공유**: 현재 keystroke마다 문서 전체 재파싱. debounce와 문서당 팩트 캐시 도입.
3. **`get_recordset` 직접 바인딩 제거**: recordset 변수 자체에 컬럼 완성이 뜨는 오해 소지. foreach 항목에만 바인딩되도록 `RECORD_METHODS`에서 분리.
4. **symlink 플러그인 디렉터리 색인**: `safeReaddir`가 `Dirent.isDirectory()`라 심볼릭 링크된 `local/*` 플러그인을 건너뜀 → `fs.statSync` 기반으로.
5. **비동기 활성화 색인**: `buildFromRoot`가 동기 `readFileSync`. 스펙 §6의 비동기·프로그레스로.
6. **nested subplugin 색인**: 현재 `root/<type>/<name>/db/install.xml`만. 서브플러그인 트리 미포함.
7. **dead code 정리 또는 결선**: `parseFrankenstyle`, `TableRepository.allTableNames()`, `IndexStore.updateFile/removeFile`(워처가 전체 재색인이라 미사용), `RecordAssignment.receiver`.
8. **resolve/describe 중복 제거**: 프로퍼티 접근 lookup을 `findPropertyAccessAt(facts, atIndex)` 헬퍼로 추출.
9. **테스트 커버리지 보강**: `sameScope` 크로스스코프(추가됨), `parseFrankenstyle` null, `closestColumn` 비기본/동점, 다중 TABLE install.xml, `updateFile/removeFile/safeParse` 실패 경로.
10. **.vsix 정리**: `.gitignore`/`.mocharc.json`/`tsconfig.test.json` 등 dev 파일 제외.

## Plan 2 (별도 계획 예정)
- **언어 문자열 인텔리전스**: `get_string('key','component')` 이동/완성/hover(한국어 값)/누락 진단. Phase 1이 증명한 색인·파서 인프라 재사용, 대부분 정규식 처리 가능.
- 이후 capability, Mustache 템플릿, JS/AMD 모듈, 웹서비스 등 mdlcode parity 확장.
