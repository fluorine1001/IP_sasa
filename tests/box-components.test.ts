import { expect, it } from 'vitest';
import { BoxComponents, BoxComponentLimit } from '../src/editor/research/box-components';

it('겹치는 닫힌 상자의 연결은 삽입 순서와 무관하게 독립 그래프 계산과 일치한다', () => {
  for (const reverse of [false, true]) {
    const boxes = Array.from({ length: 180 }, (_, i) => ({
      x: { lo: (i * 37) % 61, hi: ((i * 37) % 61) + 4 },
      y: { lo: (i * 23) % 43, hi: ((i * 23) % 43) + 3 },
    }));
    if (reverse) boxes.reverse();
    const index = new BoxComponents();
    for (let n = 0; n < boxes.length; n++) {
      index.add(boxes[n]);
      const reached = new Set<number>();
      let components = 0;
      for (let i = 0; i <= n; i++) {
        if (reached.has(i)) continue;
        components++;
        const todo = [i];
        reached.add(i);
        while (todo.length) {
          const a = boxes[todo.pop()!];
          for (let j = 0; j <= n; j++) {
            const b = boxes[j];
            if (
              !reached.has(j) &&
              a.x.lo <= b.x.hi &&
              b.x.lo <= a.x.hi &&
              a.y.lo <= b.y.hi &&
              b.y.lo <= a.y.hi
            ) {
              reached.add(j);
              todo.push(j);
            }
          }
        }
      }
      expect(index.components).toBe(components);
    }
  }
});

it('경계 접촉과 늦은 다리 연결에도 검증 대표를 재사용하며 저장 한도를 명시한다', () => {
  const index = new BoxComponents(4);
  const a = index.add({ x: { lo: 0, hi: 1 } });
  index.confirm(a.id);
  expect(index.add({ x: { lo: 3, hi: 4 } }).needsWitness).toBe(true);
  expect(index.add({ x: { lo: 1, hi: 3 } }).needsWitness).toBe(false);
  expect(index.components).toBe(1);
  expect(index.add({ x: { lo: 4, hi: 5 } }).needsWitness).toBe(false);
  expect(() => index.add({ x: { lo: 7, hi: 8 } })).toThrow(BoxComponentLimit);
});
