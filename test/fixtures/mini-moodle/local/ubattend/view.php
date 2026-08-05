<?php
echo get_string('attendance_book', 'local_ubattend');
echo get_string('pluginname', 'testmod');
echo get_string('ok');
echo get_string($dynamic, 'local_ubattend');
echo $OUTPUT->render_from_template('local_ubattend/setting', $data);
echo $OUTPUT->render_from_template('local_ubattend/svg/icon/hyflex', []);
