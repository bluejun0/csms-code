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

## 알려진 제한 (Known limitations)

추론은 현재 함수 스코프 내 로컬 데이터플로우만 추적합니다. 단순 변수 재대입은
kill-on-reassign(2026-07-31)으로 추적되지만, 구조 분해(`[$a,$b] = …`)·복합(`+=`, `??=`)·
참조(`=&`) 대입은 캡처되지 않아 이전 바인딩이 유지될 수 있습니다(낙관 동작).
오탐 시 `csmscode.diagnostics.enable`로 진단을 끄거나 해당 변수에 정확한 `@var`
주석을 달 수 있습니다.
