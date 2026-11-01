import { expect, it } from 'vitest';
import { emptyStage, newBody, newGoal, newObject } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';
import { freshProgress, updateGoals } from '../src/world/goals';
import { sweepHull } from '../src/world/hull';
import type { GoalContext } from '../src/world/types';

const plan = () => ({ launch: { x: 0, y: 0 }, impulses: [] });
const landedGoal = (id: string) => ({
  ...newGoal(),
  endTime: 0.01,
  condition: {
    kind: 'compare' as const,
    operator: 'gte' as const,
    left: { kind: 'metric' as const, metric: 'landed', targetId: id },
    right: { kind: 'constant' as const, value: 1 },
  },
});

it('제한시간의 마지막 물리 구간에서 안전하게 착륙해도 즉시 성공한다', () => {
  const s = emptyStage(),
    b = { ...newBody(), radius: 1, mu: 0 };
  s.bodies = [b];
  s.spawn = { placed: true, position: { x: 1.0005, y: 0 }, velocity: { x: -0.1, y: 0 } };
  s.rules.maxTime = 0.01;
  s.goals = [landedGoal(b.id)];
  const run = createRun(s, plan());
  tick(run, s, 0.01);
  expect(run.landed?.bodyId).toBe(b.id);
  expect(run.status).toBe('won');
});

it('목표 시작 이전 시간을 유지 실적으로 소급해서 세지 않는다', () => {
  const s = emptyStage(),
    goal = {
      ...newGoal(),
      startTime: 0.195,
      endTime: 1,
      condition: {
        kind: 'hold' as const,
        duration: 0.01,
        child: {
          kind: 'compare' as const,
          operator: 'gte' as const,
          left: { kind: 'metric' as const, metric: 'time', targetId: '' },
          right: { kind: 'constant' as const, value: 0 },
        },
      },
    };
  s.goals = [goal];
  const run = createRun(s, plan());
  run.time = 0.2;
  const c: GoalContext = { stage: s, run, before: run.position, previousTime: 0.19, dt: 0.01 };
  updateGoals(c);
  expect(run.goals[goal.id].complete).toBe(false);
  expect(run.goals[goal.id].conditionMemory?.root.hold).toBeCloseTo(0.005);
});

it('목표 배열 순서가 달라도 선행 목표는 같은 시각에 처리한다', () => {
  const s = emptyStage(),
    a = landedGoal('unused'),
    b = landedGoal('unused');
  a.condition = b.condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    right: { kind: 'constant', value: 0 },
  };
  b.dependsOn = [a.id];
  s.goals = [b, a];
  const run = createRun(s, plan());
  updateGoals({ stage: s, run, before: run.position, dt: 0, previousTime: 0 });
  expect(run.goals[b.id].complete).toBe(true);
});

it('회전하며 휩쓴 기체도 충돌하지만 멀리 있는 물체는 건드리지 않는다', () => {
  const hull = { length: 2, radius: 0.05 },
    before = { x: -1, y: 0 },
    after = { x: 0, y: -1 };
  const hit = sweepHull(
    before,
    after,
    { x: 0, y: 1 },
    hull,
    { x: 0.6, y: 0.6 },
    { x: 0.6, y: 0.6 },
    0.05,
    { x: 1, y: 0 },
  );
  expect(hit).toBeDefined();
  expect(hit!).toBeGreaterThan(0);
  expect(hit!).toBeLessThan(1);
  expect(
    sweepHull(before, after, { x: 0, y: 1 }, hull, { x: 1.2, y: 1.2 }, { x: 1.2, y: 1.2 }, 0.05, {
      x: 1,
      y: 0,
    }),
  ).toBeUndefined();
});

it('같은 구간의 정거장과 천체 중 먼저 닿은 물체가 실패 원인이다', () => {
  const s = emptyStage(),
    b = { ...newBody(), radius: 1, mu: 0 };
  s.bodies = [b];
  s.objects = [{ ...newObject('station'), position: { x: 1.5, y: 0 }, physicalRadius: 0.02 }];
  s.spawn = { placed: true, position: { x: 2, y: 0 }, velocity: { x: -200, y: 0 } };
  const run = createRun(s, plan());
  tick(run, s, 0.01);
  expect(run.status).toBe('failed');
  expect(run.reason).toContain('정거장');
  expect(run.position.x).toBeGreaterThan(1.4);
});
