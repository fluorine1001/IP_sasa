import { parseStage } from '../stages/validation';
import type { Stage } from '../world/types';
export const documentsKey = 'orbit-editor-documents-v1';
type Document = { stage: Stage; savedAt: number };
type State = { documents: Document[]; trash: Document[] };
/** Commit storage before replacing memory; failed saves never discard another document. */
export class StageDocuments {
  private state: State = { documents: [], trash: [] };
  private error = '';
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const raw = storage.getItem(documentsKey);
      if (raw) {
        const data = JSON.parse(raw) as State;
        if (!Array.isArray(data.documents) || !Array.isArray(data.trash))
          throw Error('문서 목록 형식이 올바르지 않습니다.');
        const parse = (d: Document) => ({
          stage: parseStage(d.stage, true),
          savedAt: Number(d.savedAt) || 0,
        });
        this.state = { documents: data.documents.map(parse), trash: data.trash.map(parse) };
      }
    } catch (e) {
      this.error = '이 기기 문서 목록을 읽지 못했습니다. 기존 데이터는 보존합니다. ' + String(e);
    }
  }
  list(trash = false) {
    return structuredClone(trash ? this.state.trash : this.state.documents).sort(
      (a, b) => b.savedAt - a.savedAt,
    );
  }
  get(id: string) {
    return this.list().find((d) => d.stage.id === id)?.stage;
  }
  private commit(state: State) {
    if (this.error) throw Error(this.error);
    this.storage.setItem(documentsKey, JSON.stringify(state));
    this.state = state;
  }
  put(stage: Stage) {
    this.commit({
      ...this.state,
      documents: [
        { stage: structuredClone(stage), savedAt: Date.now() },
        ...this.state.documents.filter((d) => d.stage.id !== stage.id),
      ],
    });
  }
  rename(id: string, title: string) {
    const s = this.get(id);
    if (!s) throw Error('문서가 없습니다.');
    s.title = title.trim() || '이름 없는 스테이지';
    this.put(s);
    return s;
  }
  remove(id: string) {
    const d = this.state.documents.find((d) => d.stage.id === id);
    if (d)
      this.commit({
        documents: this.state.documents.filter((t) => t !== d),
        trash: [d, ...this.state.trash.filter((t) => t.stage.id !== id)],
      });
  }
  restore(id: string) {
    const d = this.state.trash.find((d) => d.stage.id === id);
    if (d)
      this.commit({
        documents: [d, ...this.state.documents.filter((t) => t.stage.id !== id)],
        trash: this.state.trash.filter((t) => t !== d),
      });
  }
}
