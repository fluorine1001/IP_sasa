import { it, expect } from 'vitest';
import { StageDocuments, documentsKey } from '../src/editor/documents';
import { emptyStage } from '../src/stages/factory';
function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}
it('여러 UUID의 미저장 작업을 별도로 보존하고 새 세션에서도 왕복한다', () => {
  const storage = memory(),
    a = new StageDocuments(storage),
    one = emptyStage(),
    two = emptyStage();
  one.title = '첫째';
  a.put(one);
  a.put(two);
  a.rename(one.id, '새 이름');
  const b = new StageDocuments(storage);
  expect(b.list()).toHaveLength(2);
  expect(b.get(one.id)?.title).toBe('새 이름');
  expect(b.get(two.id)).toEqual(two);
});
it('로컬 삭제는 휴지통으로 이동하고 내용 손실 없이 복원한다', () => {
  const a = new StageDocuments(memory()),
    s = emptyStage();
  a.put(s);
  a.remove(s.id);
  expect(a.get(s.id)).toBeUndefined();
  expect(a.list(true)[0].stage).toEqual(s);
  a.restore(s.id);
  expect(a.get(s.id)).toEqual(s);
  expect(a.list(true)).toEqual([]);
});
it('잘못된 목록은 자동 저장으로 덮어쓰지 않는다', () => {
  const s = memory();
  s.setItem(documentsKey, '{broken');
  const a = new StageDocuments(s);
  expect(() => a.put(emptyStage())).toThrow('보존');
  expect(s.getItem(documentsKey)).toBe('{broken');
});
it('저장 공간 부족은 현재 메모리와 이전 디스크 문서를 보존한다', () => {
  const s = memory(),
    a = new StageDocuments(s),
    stage = emptyStage();
  a.put(stage);
  s.setItem = () => {
    throw Error('quota');
  };
  expect(() => a.put({ ...stage, title: '잃을 수정' })).toThrow('quota');
  expect(a.get(stage.id)).toEqual(stage);
});
