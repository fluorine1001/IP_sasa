import { expect, it } from 'vitest';
import { recentPushes, PUSH_SHOW } from '../src/render/push-effect';
import type { Run, Stage } from '../src/world/types';

const cold = { rocket: undefined } as unknown as Stage;
const run = (time: number, applied: string[] = ['p']) =>
  ({
    time,
    applied: new Set(applied),
    plan: {
      launch: { x: 0.5, y: 0 },
      impulses: [{ id: 'p', time: 2, vector: { x: 0, y: 0.1 } }],
    },
  }) as unknown as Run;

it('추진은 실제로 실행된 뒤 잠깐만 보이고 앞으로의 추진은 보이지 않는다', () => {
  expect(recentPushes(run(0.1), cold).map((p) => p.launch)).toEqual([true]);
  expect(recentPushes(run(1.9), cold)).toEqual([]);
  expect(recentPushes(run(2.3), cold)).toEqual([
    { vector: { x: 0, y: 0.1 }, age: expect.closeTo(0.3), launch: false },
  ]);
  expect(recentPushes(run(2 + PUSH_SHOW + 0.01), cold)).toEqual([]);
  expect(recentPushes(run(2.3, []), cold)).toEqual([]);
  expect(recentPushes(undefined, cold)).toEqual([]);
});
