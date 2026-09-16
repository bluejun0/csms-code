<?php

defined('MOODLE_INTERNAL') || die;

$functions = [
    'local_ubattend_get_sessions' => [
        'classname' => 'local_ubattend\external\Session',
        'methodname' => 'get_sessions',
        'description' => '출석 세션 목록',
        'type' => 'read',
    ],
    'local_ubattend_save_attendance' => [
        'classname' => 'local_ubattend\external\Session',
        'methodname' => 'save',
        'description' => '출석 저장',
        'type' => 'write',
    ],
];
