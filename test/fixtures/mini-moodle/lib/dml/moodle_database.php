<?php
abstract class moodle_database {
    /** @var string 테이블 접두사 */
    public $prefix = '';
    /** @var int 내부 상태 */
    private $counter = 0;

    /**
     * 레코드 하나를 가져온다.
     * 자세한 설명은 여기에 이어진다.
     */
    public function get_record($table, array $conditions) {
    }

    /** 레코드를 갱신한다. */
    public function update_record($table, $dataobject) {
    }

    protected function internal_helper() {
    }

    private function secret() {
    }
}
