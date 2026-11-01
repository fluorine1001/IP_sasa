import { expect, it } from 'vitest';
import { emptyStage, newGoal } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';
import { firstChangeTime } from '../src/world/first-change';
import { goalStatus } from '../src/screens/flight/goal-status';
import { resultSummary } from '../src/screens/flight/result-summary';

it('실제 관측된 목표 접근값을 기록하고 성공 판정은 바꾸지 않는다', () => {
  const s = emptyStage();
  s.spawn.placed = true;
  s.spawn.velocity = { x: 1, y: 0 };
  s.rules.maxTime = 0.1;
  const g = newGoal();
  g.endTime = 1;
  g.condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'x', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 1 },
  };
  s.goals = [g];
  const run = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  tick(run, s, 0.1);
  expect(run.goals[g.id].complete).toBe(false);
  expect(run.goals[g.id].closest?.root.value).toBeCloseTo(0.1);
  expect(resultSummary(s, run)).toContain('관측 0.10');
});
it('선행 조건, 시간 창, 유지 시간 상태를 구분한다', () => {
  const s = emptyStage(),
    g = newGoal(),
    pre = newGoal();
  s.goals = [g, pre];
  g.dependsOn = [pre.id];
  g.startTime = 1;
  g.endTime = 3;
  const run = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  expect(goalStatus(g, run)).toBe('잠김');
  run.goals[pre.id].complete = true;
  expect(goalStatus(g, run)).toBe('대기');
  run.time = 2;
  run.goals[g.id].conditionMemory = { root: { hold: 0.5, index: 0, latched: false } };
  expect(goalStatus(g, run)).toContain('유지 중');
  run.time = 4;
  expect(goalStatus(g, run)).toBe('놓침');
  run.goals[g.id].complete = true;
  expect(goalStatus(g, run)).toBe('완료');
});
it('재발사 시 최초로 달라진 예약 시각을 찾고 ID 차이는 무시한다', () => {
  const a = { launch: { x: 0, y: 0 }, impulses: [{ id: 'a', time: 2, vector: { x: 1, y: 0 } }] };
  const b = { launch: { x: 0, y: 0 }, impulses: [{ id: 'b', time: 3, vector: { x: 1, y: 0 } }] };
  expect(firstChangeTime(a, b)).toBe(2);
  expect(firstChangeTime(a, { ...a, impulses: [{ ...a.impulses[0], id: 'new' }] })).toBeUndefined();
});
