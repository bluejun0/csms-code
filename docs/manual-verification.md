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

## 알려진 제한 (Known limitations)

추론은 현재 함수 스코프 내 로컬 데이터플로우만 추적하며, 레코드 대입 후 같은 변수를
다른 값으로 재대입(예: `$rec = build_row();`)하는 경우 그 재대입을 추적하지 못해
이전 테이블 바인딩이 남아 드물게 정상 코드에 오탐 경고가 날 수 있습니다. 이 경우
`csmscode.diagnostics.enable`로 진단을 끄거나 해당 변수에 정확한 `@var` 주석을 달 수
있습니다. (kill-on-reassign은 후속 단계 예정.)
