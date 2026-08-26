/** 설정의 plugin은 config_plugins의 저장 키 그 자체라 정규화하지 않는다 — `ubboard`와 `mod_ubboard`는 다른 행이다.
 *  Moodle의 get_config·admin_setting이 `$CFG`로 보내는 별칭만 core로 접는다. */
export function configPlugin(raw: string): string {
  return raw === '' || raw === 'moodle' || raw === 'core' ? 'core' : raw;
}

/** 선언 색인·사용처 색인이 함께 쓰는 키 */
export function configKeyId(plugin: string, key: string): string {
  return `${configPlugin(plugin)}/${key}`;
}
