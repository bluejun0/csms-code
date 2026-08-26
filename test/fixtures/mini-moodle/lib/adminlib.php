<?php
class admin_setting_special_gradebookroles extends admin_setting_configmulticheckbox {
    public function __construct() {
        parent::__construct('gradebookroles', 'x', 'y', null, null);
    }
}
