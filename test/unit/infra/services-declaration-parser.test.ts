import { strict as assert } from 'assert';
import { parseServiceDeclarations } from '../../../src/infrastructure/services/services-declaration-parser';

describe('parseServiceDeclarations', () => {
  it('짧은 배열 문법의 함수 선언을 읽는다', () => {
    const text = `<?php
$functions = [
    'coursemos_user_login_v2' => [
        'classname' => 'local_coursemos\\external\\User',
        'methodname' => 'login',
        'description' => '사용자 토큰을 생성합니다.',
        'type' => 'read',
    ],
];
`;
    assert.deepEqual(parseServiceDeclarations(text), [{
      name: 'coursemos_user_login_v2',
      classname: 'local_coursemos\\external\\User',
      methodname: 'login',
      description: '사용자 토큰을 생성합니다.',
      type: 'read',
      line: 2,
    }]);
  });

  it('array() 문법도 같은 결과를 준다', () => {
    const text = `<?php
$functions = array(
    'get_course_section_vod_subtitle' => array(
        'classname'     => 'local_ubllmapi_external',
        'methodname'    => 'course_section_vod_subtitle',
        'description'   => '강좌 자막 리스트',
        'type'          => 'read',
    ),
);
`;
    assert.deepEqual(parseServiceDeclarations(text), [{
      name: 'get_course_section_vod_subtitle',
      classname: 'local_ubllmapi_external',
      methodname: 'course_section_vod_subtitle',
      description: '강좌 자막 리스트',
      type: 'read',
      line: 2,
    }]);
  });

  it('빠진 필드는 빈 문자열로 채운다', () => {
    const text = `<?php
$functions = [
    'minimal_fn' => [
        'classname' => 'local_x_external',
    ],
];
`;
    assert.deepEqual(parseServiceDeclarations(text), [{
      name: 'minimal_fn',
      classname: 'local_x_external',
      methodname: '',
      description: '',
      type: '',
      line: 2,
    }]);
  });

  it('선언 안의 중첩 배열을 함수로 오인하지 않는다', () => {
    const text = `<?php
$functions = [
    'real_fn' => [
        'classname' => 'local_x_external',
        'capabilities' => ['moodle/site:config', 'moodle/course:view'],
        'services' => [MOODLE_OFFICIAL_MOBILE_SERVICE],
        'methodname' => 'run',
    ],
];
`;
    assert.deepEqual(parseServiceDeclarations(text).map(f => f.name), ['real_fn']);
    assert.equal(parseServiceDeclarations(text)[0].methodname, 'run');
  });

  it('주석 처리된 선언은 읽지 않는다', () => {
    const text = `<?php
$functions = [
    // 'disabled_fn' => [
    //     'classname' => 'local_x_external',
    // ],
    /* 'block_fn' => ['classname' => 'local_y_external'], */
    'live_fn' => [
        'classname' => 'local_x_external',
    ],
];
`;
    assert.deepEqual(parseServiceDeclarations(text).map(f => f.name), ['live_fn']);
  });

  it('$functions 밖의 배열은 읽지 않는다', () => {
    const text = `<?php
$services = [
    'CSMS API' => [
        'functions' => ['real_fn'],
        'shortname' => 'csmsapi',
    ],
];
$functions = [
    'real_fn' => [
        'classname' => 'local_x_external',
    ],
];
`;
    assert.deepEqual(parseServiceDeclarations(text).map(f => f.name), ['real_fn']);
  });

  it('함수가 여러 개면 선언 순서대로 각자의 줄을 준다', () => {
    const text = `<?php
$functions = [
    'fn_a' => ['classname' => 'local_x_external', 'methodname' => 'a'],

    'fn_b' => ['classname' => 'local_x_external', 'methodname' => 'b'],
];
`;
    assert.deepEqual(parseServiceDeclarations(text).map(f => `${f.name}:${f.line}`), ['fn_a:2', 'fn_b:4']);
  });

  it('$functions 선언이 없으면 빈 배열', () => {
    assert.deepEqual(parseServiceDeclarations('<?php\n$other = [1, 2];\n'), []);
  });
});
