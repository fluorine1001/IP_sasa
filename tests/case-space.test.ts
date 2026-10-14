import { it, expect } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { solutionSpace } from '../src/editor/solution-space';
import { parameterPlan } from '../src/editor/solution-search';
import { programEvents } from '../src/world/program';

it('가중 DP의 총 경우 수와 완전 열거가 일치하고 경계 값도 빠뜨리지 않는다', () => {
  const s = blankStage();
  s.rocket = undefined;
  s.rules.commandLimits = { push: 1 };
  const space = solutionSpace(s),
    grid = space.grid(2);
  expect(grid.total).toBe('252');
  let count = 0;
  const values = new Set<number>();
  for (let item = grid.next(); item; item = grid.next()) {
    count++;
    item.coordinates.forEach((v) => values.add(v));
    const p = parameterPlan(item.template, item.coordinates);
    expect(p.launch.x).toBeGreaterThanOrEqual(-s.rules.launchLimit - 1e-8);
  }
  expect(count).toBe(252);
  expect(grid.exhausted).toBe(true);
  expect(values).toEqual(new Set([0, 0.5, 1]));
});
it('출력은 양수 경우만 세며 끄기는 별도 간선으로 열거한다', () => {
  const s = blankStage();
  s.rules.commandLimits = { ignite: 1, stop: 1, turn: 0, separate: 0, push: 0, deploy: 0 };
  const grid = solutionSpace(s).grid(2);
  // First power: 3. Empty:1, ignite:6, stop:3, two orders:18 each.
  expect(grid.total).toBe('138');
  let count = 0;
  for (let item = grid.next(); item; item = grid.next()) count++;
  expect(count).toBe(138);
});
it('게임에서 금지된 연료 로켓의 순간 수정 추진을 탐색 문법에서도 생성하지 않는다', () => {
  const s = blankStage();
  s.rules.commandLimits = { ignite: 0, stop: 1, turn: 0, separate: 0, push: 1, deploy: 0 };
  const space = solutionSpace(s);
  expect(space.total).toBe('2');
  for (let t = space.next(); t; t = space.next()) {
    expect(t.plan.impulses).toHaveLength(0);
    expect(programEvents(t.plan).some((e) => e.kind === 'push')).toBe(false);
  }
});
