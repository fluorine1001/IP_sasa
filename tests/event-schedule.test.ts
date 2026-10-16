import { expect, it } from 'vitest';
import { createRun } from '../src/world/engine';
import { blankStage } from '../src/stages/factory';
import {
  dueEvents,
  nextEventTime,
  copyEventCursor,
  invalidateEventSchedule,
  retimeEventSchedule,
  eventTimeClearance,
} from '../src/world/event-schedule';
import type { RoutePlan } from '../src/world/types';

it('순서가 뒤섞인·같은 시각·허용 오차 경계·중복 ID에서도 이전 전체 순회와 정확히 일치한다', () => {
  let seed = 719;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 2 ** 32;
  };
  const stage = blankStage();
  for (let trial = 0; trial < 100; trial++) {
    const plan: RoutePlan = { launch: { x: 0, y: 0 }, impulses: [], engineCommands: [] };
    for (let i = 0; i < 48; i++) {
      const time = Math.floor(random() * 8) * 0.1 + [0, 1e-8, 1.1e-8][i % 3];
      const id = `e-${Math.floor(random() * 40)}`;
      if (i % 3 === 0) plan.impulses.push({ id, time, vector: { x: 0, y: 0 } });
      else plan.engineCommands!.push({ id, actorId: 'craft', time, throttle: 0 });
    }
    const run = createRun(stage, plan);
    for (let j = 0; j < 12; j++) {
      run.time = j * 0.1;
      const applied = new Set(run.applied),
        expected: string[] = [];
      for (const event of [...run.plan.engineCommands!, ...run.plan.impulses])
        if (event.time <= run.time + 1e-8 && !applied.has(event.id)) {
          expected.push(event.id);
          applied.add(event.id);
        }
      const actual: string[] = [];
      for (const e of dueEvents(run))
        if (!run.applied.has(e.value.id)) {
          actual.push(e.value.id);
          run.applied.add(e.value.id);
        }
      expect(actual).toEqual(expected);
      expect(nextEventTime(run)).toBe(
        [...run.plan.impulses, ...run.plan.engineCommands!]
          .filter((e) => !run.applied.has(e.id) && e.time > run.time + 1e-8)
          .reduce((n, e) => Math.min(n, e.time), Infinity),
      );
    }
  }
});

it('순서가 같은 시각 미분은 기존 커서의 다음 시각도 즉시 갱신한다', () => {
  const stage = blankStage(),
    plan = {
      launch: { x: 0, y: 0 },
      impulses: [],
      engineCommands: [
        { id: 'a', actorId: 'craft', time: 0.2, throttle: 0 },
        { id: 'b', actorId: 'craft', time: 0.8, throttle: 0 },
      ],
    };
  const run = createRun(stage, plan),
    command = run.plan.engineCommands![0];
  expect(nextEventTime(run)).toBe(0.2);
  expect(eventTimeClearance(run.plan, command)).toBeCloseTo(0.6);
  command.time = 0.21;
  retimeEventSchedule(run.plan, command);
  expect(nextEventTime(run)).toBe(0.21);
  command.time = 0.9;
  retimeEventSchedule(run.plan, command);
  expect(nextEventTime(run)).toBe(0.8);
});
it('공통 과거의 커서를 O(1)에 복사하며 명시적인 시각 변경은 새 인덱스를 사용한다', () => {
  const stage = blankStage(),
    plan = {
      launch: { x: 0, y: 0 },
      impulses: [],
      engineCommands: [
        { id: 'a', actorId: 'craft', time: 0.1, throttle: 0 },
        { id: 'b', actorId: 'craft', time: 0.8, throttle: 0 },
      ],
    };
  const run = createRun(stage, plan);
  run.time = 0.3;
  for (const e of dueEvents(run)) run.applied.add(e.value.id);
  const copy = structuredClone(run);
  copy.plan = run.plan;
  copyEventCursor(run, copy);
  expect(nextEventTime(copy)).toBe(0.8);
  copy.plan.engineCommands![1].time = 0.6;
  invalidateEventSchedule(copy.plan);
  expect(nextEventTime(copy)).toBe(0.6);
  expect(copy.applied).toEqual(run.applied);
});
