define(['core/str', 'core/templates'], function(str, Templates) {
    str.get_string('attendance_book', 'local_ubattend');
    Templates.render('local_ubattend/setting', {});
});
