/** key별 debounce 타이머. 같은 key로 재호출하면 리셋되어 마지막 fn만 실행된다.
 *  vscode 의존 없음 — 유닛 테스트 가능. */
export class KeyedDebouncer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private delayMs: number) {}

  schedule(key: string, fn: () => void): void {
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev);
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); fn(); }, this.delayMs));
  }

  cancel(key: string): void {
    const t = this.timers.get(key);
    if (t) { clearTimeout(t); this.timers.delete(key); }
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
