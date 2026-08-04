# CSMS Code — Phase 2 백로그 & 알려진 제한

Phase 1 (DB stdClass 인텔리전스)은 완료되었습니다. 아래는 종합 리뷰에서 도출된 후속 작업과 배포 전 필수 게이트입니다.

## 배포 전 필수 (하드 게이트)
- **통합 테스트를 CI/xvfb에서 통과시킬 것.** `@vscode/test-electron` 통합 테스트는 이 개발 샌드박스(headless WSL2)에서 Electron이 크래시(SIGTRAP)해 실행되지 않았다. 정적 컴파일(`tsc -p tsconfig.test.json`)은 통과. 이 테스트는 WASM 번들(`dist/`) + `activate()` 결선을 검증하는 **유일한** 커버리지이므로, 실배포 전 반드시 CI(예: `xvfb-run`)에서 녹색 확인 필요.
- **`package.json`에 실제 사내 git repository URL 지정.** 현재 `repository` 필드는 제거된 상태(지어낸 URL 방지). `package` 스크립트는 `--allow-missing-repository`로 동작.

## 알려진 제한 (Phase 1)
- **구조 분해·복합·참조 대입 미추적**: kill-on-reassign(2026-07-31)은 단순 변수 LHS 대입만 캡처한다. `[$a, $b] = …`, `+=`, `??=`, `=&` 등은 캡처되지 않아 이전 바인딩이 유지된다(낙관 동작, 실코드에서 레코드 변수에 드묾). `$rec = enrich($rec);` 같은 자기참조 재대입은 RHS 안의 `$rec` 사용에도 kill이 적용되어 인텔리전스가 침묵한다(오탐은 아님).
- **dataarg 위치 무관**: insert/update 힌트는 스코프 전역이라 재대입과 무관하게 폴백으로 평가된다(다중 테이블 모호 시 null 가드 유지). `new stdClass` 후 insert 패턴 보존을 위한 의도된 동작.
- **빈 클로저 스코프 미인식**: 팩트가 하나도 없는 클로저(대입·접근·foreach·phpdoc 전무)는 완성의 스코프 축소에 보이지 않아 바깥 스코프로 폴백한다(2026-08-04 최종 리뷰 잔여 갭 — 실코드에서 극히 드묾).

## Phase 2 후속 작업 (우선순위 순)
1. ~~**kill-on-reassign 추론**~~ — ✅ 완료 (2026-07-31, 설계: `docs/superpowers/specs/2026-07-31-kill-on-reassign-design.md`). 재대입 오탐 제거 + foreach 가림 버그 수정.
2. ~~**진단 debounce + 파싱 공유**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-diagnostics-debounce-facts-cache-design.md`). 문서별 300ms debounce + 텍스트 키 LRU 팩트 캐시(용량 8).
3. ~~**`get_recordset` 직접 바인딩 제거**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-recordset-scope-polish-design.md`). get_records(배열)까지 넓혀 직접 바인딩은 단일 레코드 메서드(get_record/get_record_select)로만 한정.
4. ~~**symlink 플러그인 디렉터리 색인**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-symlink-index-hardening-design.md`). 심볼릭 링크 엔트리만 statSync로 확인, 깨진 링크는 조용히 제외.
5. **비동기 활성화 색인**: `buildFromRoot`가 동기 `readFileSync`. 스펙 §6의 비동기·프로그레스로.
6. **nested subplugin 색인**: 현재 `root/<type>/<name>/db/install.xml`만. 서브플러그인 트리 미포함.
7. **dead code 정리 또는 결선**: `parseFrankenstyle`, `TableRepository.allTableNames()`, `IndexStore.updateFile/removeFile`(워처가 전체 재색인이라 미사용), `RecordAssignment.receiver`.
8. **resolve/describe 중복 제거**: 프로퍼티 접근 lookup을 `findPropertyAccessAt(facts, atIndex)` 헬퍼로 추출.
9. **테스트 커버리지 보강**: `sameScope` 크로스스코프(추가됨), `parseFrankenstyle` null, `closestColumn` 비기본/동점, 다중 TABLE install.xml, `updateFile/removeFile/safeParse` 실패 경로.
10. **.vsix 정리**: `.gitignore`/`.mocharc.json`/`tsconfig.test.json` 등 dev 파일 제외.
11. ~~**`scopeContaining()`에 plainAssignments 반영**~~ — ✅ 완료 (2026-08-04, 같은 설계 문서). 일반 대입만 있는 클로저의 바깥 바인딩 누수 수정.
12. ~~**재발 방지 하드닝(2026-08-04 최종 리뷰)**~~ — ✅ 완료 (2026-08-04, 같은 설계 문서). scopeContaining 구조적 유도 + E2E 음성 핀 + get_records_select 핀.

## Plan 2 (별도 계획 예정)
- **언어 문자열 인텔리전스**: `get_string('key','component')` 이동/완성/hover(한국어 값)/누락 진단. Phase 1이 증명한 색인·파서 인프라 재사용, 대부분 정규식 처리 가능.
- 이후 capability, Mustache 템플릿, JS/AMD 모듈, 웹서비스 등 mdlcode parity 확장.
