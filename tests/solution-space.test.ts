import { it, expect } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { defaultRocket } from '../src/world/rocket';
import { solutionSpace } from '../src/editor/solution-space';
import { globalSearch } from '../src/editor/global-search';
import { parameterPlan, searchParameters } from '../src/editor/solution-search';
import { commandUsage, planConstraints } from '../src/world/program';
import { blockerProposals } from '../src/editor/blockers';

it('순서·횟수·분리체를 포함한 유한 예약 구성을 중복 없이 전부 열거한다', () => {
  const stage = blankStage();
  stage.rocket = defaultRocket();
  stage.rocket.parts = stage.rocket.parts.slice(0, 1);
  stage.rules.commandLimits = { ignite: 1, stop: 0, turn: 0, separate: 1, push: 0 };
  const space = solutionSpace(stage),
    layouts = [];
  for (let template = space.next(); template; template = space.next()) layouts.push(template);
  // Empty, ignition, separation, ignition→separation, separation→detached ignition.
  expect(space.total).toBe('5');
  expect(layouts).toHaveLength(5);
  expect(space.exhausted).toBe(true);
  expect(
    layouts.some(
      (layout) => layout.plan.engineCommands?.[1]?.actorId === stage.rocket!.parts[0].id,
    ),
  ).toBe(true);
  expect(layouts.every((t) => !planConstraints(stage, t.plan).length)).toBe(true);
  expect(new Set(layouts.map((t) => JSON.stringify(t.plan.engineCommands))).size).toBe(5);
});
it('두 단 이상과 반복 회전·꺼짐을 누락하지 않고 긴 구성도 일찍 조사한다', () => {
  const stage = blankStage();
  stage.rocket = defaultRocket();
  stage.rules.commandLimits = { ignite: 0, stop: 1, turn: 2, separate: 2, push: 0 };
  const space = solutionSpace(stage);
  const first = Array.from({ length: 6 }, () => space.next()!);
  expect(first.map((t) => t.plan.engineCommands!.length)).toEqual([0, 1, 2, 3, 4, 5]);
  const rest = [];
  for (let t = space.next(); t; t = space.next()) rest.push(t);
  expect(
    rest.some((t) => commandUsage(t.plan).turn === 2 && commandUsage(t.plan).separate === 2),
  ).toBe(true);
  expect(new Set([...first, ...rest].map((t) => JSON.stringify(t.plan.engineCommands))).size).toBe(
    Number(space.total),
  );
});
it('시각 매개변수는 순서를 보존하며 양 끝·같은 시각과 0 출력을 포함한다', () => {
  const stage = blankStage();
  stage.rocket = defaultRocket();
  stage.rules.commandLimits = { ignite: 1, stop: 1, turn: 0, separate: 0, push: 0 };
  const plan = {
    launch: { x: 0, y: 0 },
    impulses: [],
    engineCommands: [
      { id: 'a', actorId: 'craft', time: 0.2, throttle: 0.5 },
      { id: 'b', actorId: 'craft', time: 0.3, throttle: 0 },
    ],
  };
  const template = { id: 'x', label: 'x', plan, parameters: searchParameters(stage, plan) };
  const result = parameterPlan(
    template,
    template.parameters.map(() => 0),
  );
  expect(result.launch).toEqual({ x: 0, y: 0 });
  expect(result.engineCommands!.map((c) => c.time)).toEqual([0, 0]);
  for (const values of [
    [1, 0.8, 0.5, 0.1],
    [0.3, 0.1, 0.9, 0.8],
  ]) {
    const p = parameterPlan(template, values);
    expect(p.engineCommands![1].time).toBeGreaterThanOrEqual(p.engineCommands![0].time);
  }
});
it('전역 탐색은 기준 계획이 없어도 임의의 다른 조작 구성을 조사하고 예산을 넘기지 않는다', () => {
  const stage = blankStage();
  stage.rocket = undefined;
  stage.launchBodyId = undefined;
  stage.spawn.position = { x: 2, y: 0 };
  stage.bodies[0].mu = 0;
  stage.rules.maxTime = 0.2;
  stage.audit.timeLimit = 0.2;
  stage.rules.commandLimits = { push: 2 };
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.05 },
  };
  const report = [...globalSearch(stage, [], 40)].at(-1)!;
  expect(report.evaluated).toBeLessThanOrEqual(40);
  expect(report.successes).toBeGreaterThan(0);
  expect(report.scope!.programs).toBe(3);
  expect(report.scope!.bounded).toBe(true);
  expect(report.families.some((f) => f.representative.impulses.length === 2)).toBe(true);
});
it('차단안은 특정 검증 기록을 특권적으로 보존하지 않고 다른 해에 대한 영향을 반환한다', () => {
  const stage = blankStage();
  stage.rules.maxTime = 0.12;
  stage.audit.timeLimit = 0.12;
  stage.goals[0].condition = {
    kind: 'hold',
    duration: 0.1,
    child: {
      kind: 'compare',
      left: { kind: 'metric', metric: 'time', targetId: '' },
      operator: 'gte',
      right: { kind: 'constant', value: 0 },
    },
  };
  const plan = { launch: { x: 0, y: 0 }, impulses: [] };
  stage.referencePlans = [plan];
  const proposals = blockerProposals(stage, {
    id: 0,
    template: '',
    representative: plan,
    count: 1,
    ranges: [],
    trail: [],
    samples: [plan],
  });
  expect(proposals.length).toBeGreaterThan(0);
  expect(proposals[0].blocked).toBe(1);
});
it('추가 예산은 발견된 집합·열거 위치를 유지하고 이전 검사부터 반복하지 않는다', () => {
  const stage = blankStage();
  stage.rules.maxTime = 0.1;
  stage.audit.timeLimit = 0.1;
  stage.rules.commandLimits = { ignite: 1, stop: 1, turn: 1, separate: 0, push: 0 };
  const quota = { remaining: 16, total: 16 },
    iterator = globalSearch(stage, [], 16, undefined, quota);
  let first;
  for (let n = 0; n < 100; n++) {
    const next = iterator.next();
    if (!next.done && next.value.done) {
      first = next.value;
      break;
    }
  }
  expect(first!.evaluated).toBe(16);
  quota.remaining += 16;
  quota.total += 16;
  let second;
  for (let n = 0; n < 100; n++) {
    const next = iterator.next();
    if (!next.done && next.value.done) {
      second = next.value;
      break;
    }
  }
  expect(second!.evaluated).toBe(32);
  expect(second!.scope!.programs).toBeGreaterThanOrEqual(first!.scope!.programs);
  iterator.return(undefined);
});
