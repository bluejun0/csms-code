<?php
$settings->add(new admin_setting_configtext('local_ubattend/attendlimit', '출석 상한', '설명', 10));
$settings->add(new admin_setting_configcheckbox('ubattend_simple', '단순 모드', '', 0));
$pluginname = 'local_ubattend';
$name = $pluginname . '/apikey';
$settings->add(new admin_setting_configtext($name, 'API 키', '', ''));
$name = 'local_ubattend/mode';
$settings->add(new admin_setting_configselect($name, '모드', '', 0, []));
$settings->add(new admin_setting_heading('local_ubattend/head', '제목', ''));
