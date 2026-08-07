<?php
$settings->add(new admin_setting_configtext('local_ubattend/attendlimit', '출석 상한', '설명', 10));
$settings->add(new admin_setting_configcheckbox('ubattend_simple', '단순 모드', '', 0));
