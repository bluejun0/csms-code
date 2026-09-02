import * as fs from 'fs';
import { Table } from '../../domain/moodle-model/table';
import { TableRepository } from '../../domain/moodle-model/ports/table-repository';
import { parseInstallXml, InMemoryTableRepository } from '../xmldb/xmldb-table-repository';
import { listInstallXmlFiles, listInstallXmlFilesAsync, yieldNow, INDEX_YIELD_EVERY } from '../workspace/moodle-root-resolver';

export class IndexStore implements TableRepository {
  private repo = new InMemoryTableRepository();

  buildFromRoot(root: string): void {
    const all: Table[] = [];
    for (const { file, component } of listInstallXmlFiles(root)) {
      all.push(...safeParse(file, component));
    }
    this.repo.replaceAll(all);
  }

  /** 활성화 경로용 — 열거·읽기 모두 비동기이고 200파일마다 이벤트 루프를 양보한다.
   *  완성된 목록을 만든 뒤 마지막에 교체하므로 빌드 중 조회가 부분 결과를 보지 않는다. */
  async buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const refs = await listInstallXmlFilesAsync(root);
    const all: Table[] = [];
    let done = 0;
    for (const { file, component } of refs) {
      all.push(...await safeParseAsync(file, component));
      done++;
      if (done % INDEX_YIELD_EVERY === 0) { onProgress?.(done, refs.length); await yieldNow(); }
    }
    onProgress?.(refs.length, refs.length);
    this.repo.replaceAll(all);
  }

  /** install.xml 하나가 바뀌면 그 파일의 테이블만 갱신 */
  updateFile(file: string, component: string): void {
    this.repo.removeByUri(file);
    this.repo.upsert(safeParse(file, component));
  }
  removeFile(uri: string): void { this.repo.removeByUri(uri); }

  getTable(name: string) { return this.repo.getTable(name); }
  allTableNames() { return this.repo.allTableNames(); }
  tablesIn(file: string) { return this.repo.tablesIn(file); }
}

function safeParse(file: string, component: string): Table[] {
  try { return parseInstallXml(fs.readFileSync(file, 'utf8'), file, component); }
  catch { return []; }
}

async function safeParseAsync(file: string, component: string): Promise<Table[]> {
  try { return parseInstallXml(await fs.promises.readFile(file, 'utf8'), file, component); }
  catch { return []; }
}
