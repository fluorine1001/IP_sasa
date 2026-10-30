import { expect, it } from 'vitest';
import { campaignChapters } from '../src/stages/chapters';
import { blankStage } from '../src/stages/factory';
it('기존 임무도 챕터별로 나뉘며 사용자 챕터·완료 UUID·천체 없는 임무를 보존한다', () => {
  const a = blankStage(),
    b = blankStage(),
    c = blankStage();
  a.order = 1;
  b.order = 6;
  c.order = 12;
  c.bodies = [];
  c.chapter = { id: 'my-world', title: '나의 항로', order: 9 };
  const groups = campaignChapters([c, b, a], new Set([b.id]));
  expect(groups.map((g) => g.id)).toEqual(['departure', 'expedition', 'my-world']);
  expect(groups[1].completed).toBe(1);
  expect(groups[2].stages[0]).toBe(c);
  expect(groups[2].title).toBe('나의 항로');
});
