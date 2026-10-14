import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { FlightPrefixCache } from '../src/editor/flight-prefix';
import { createRun, tick, execute } from '../src/world/engine';
import { searchParameters, searchSolutions } from '../src/editor/solution-search';
import type { RoutePlan } from '../src/world/types';

it('완료 이전에 바뀐 예약은 재사용하지 않고 모든 완료 이후 suffix는 같은 결과를 갖는다', () => {
  const stage = blankStage();
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.15 },
  };
  const base: RoutePlan = {
    launch: { x: stage.rules.launchLimit, y: 0 },
    impulses: [],
    engineCommands: [],
  };
  const done = execute(stage, base),
    cache = new FlightPrefixCache();
  cache.save(done, [], 1);
  for (const time of [0.3, 0.7, 1, 5]) {
    const plan = { ...base, engineCommands: [{ id: 'late', actorId: 'craft', time, throttle: 0 }] };
    const restored = cache.restore(plan, 20)!;
    expect(restored.run.status).toBe(execute(stage, plan).status);
    expect(restored.run.position).toEqual(done.position);
    expect(restored.run.initialPlan).toEqual(plan);
  }
  expect(
    cache.restore(
      { ...base, engineCommands: [{ id: 'early', actorId: 'craft', time: 0.1, throttle: 0 }] },
      20,
    ),
  ).toBeUndefined();
  expect(cache.restore({ ...base, launch: { x: 0, y: 0 } }, 20)).toBeUndefined();
  expect(cache.terminalReused).toBe(4);
});
it('진행 중인 공통 구간을 복원해도 연료·판정 기억·명령 적용·최종 상태가 실제 일괄 비행과 같다', () => {
  const stage = blankStage();
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.9 },
  };
  const base: RoutePlan = {
    launch: { x: stage.rules.launchLimit, y: 0 },
    impulses: [],
    engineCommands: [{ id: 'first', actorId: 'craft', time: 0.1, throttle: 0.8 }],
  };
  const run = createRun(stage, base),
    cache = new FlightPrefixCache();
  for (let i = 0; i < 4; i++) tick(run, stage, 0.1, stage.objects, false);
  cache.save(run, [], 0.2);
  const plan = {
    ...base,
    engineCommands: [
      ...base.engineCommands!,
      { id: 'later', actorId: 'craft', time: 0.7, throttle: 0 },
    ],
  };
  const restored = cache.restore(plan, 20)!.run;
  while (['running', 'impact'].includes(restored.status))
    tick(restored, stage, 0.1, stage.objects, false);
  const real = execute(stage, plan);
  for (const k of ['time', 'status', 'position', 'velocity', 'rocket', 'goals', 'applied'] as const)
    expect(restored[k]).toEqual(real[k]);
  expect(cache.restore(plan, 0.2)).toBeUndefined();
});
it('탐색의 prefix 재사용은 대표의 실제 재검증을 통과하며 상수 고정 범위를 바꾸지 않는다', () => {
  const stage = blankStage();
  stage.rules.maxTime = 1;
  stage.audit.timeLimit = 1;
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.15 },
  };
  const cache = new FlightPrefixCache();
  for (const time of [0.6, 0.7, 0.8]) {
    const plan: RoutePlan = {
      launch: { x: stage.rules.launchLimit, y: 0 },
      impulses: [],
      engineCommands: [{ id: 'stop', actorId: 'craft', time, throttle: 0 }],
    };
    const result = [
      ...searchSolutions(
        stage,
        {
          id: 'fixed',
          label: 'fixed',
          plan,
          parameters: searchParameters(stage, plan).map((p) => ({ ...p, enabled: false })),
        },
        1,
        false,
        undefined,
        cache,
      ),
    ].at(-1)!;
    expect(result.successes).toBe(1);
    expect(execute(stage, result.families[0].representative).status).toBe('won');
  }
  expect(cache.terminalReused).toBe(2);
});
