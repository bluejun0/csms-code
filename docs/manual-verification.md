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
