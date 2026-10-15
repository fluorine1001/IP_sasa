import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { createRun, tick, execute } from '../src/world/engine';
import { parameterPlan, searchParameters, searchSolutions } from '../src/editor/solution-search';
import { trajectoryAdjoint, trajectoryScore } from '../src/editor/trajectory-adjoint';

it('실제 물리의 모든 제어 미분을 전 구간 재비행보다 적은 국소 전이로 계산한다', () => {
  const stage = blankStage();
  stage.bodies = [];
  stage.launchBodyId = undefined;
  stage.spawn = { position: { x: 3, y: 3 }, velocity: { x: 0, y: 0 }, placed: true };
  stage.rocket!.parts = stage.rocket!.parts.slice(0, 1);
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 2;
  stage.rules.commandLimits = { turn: 64, ignite: 0, stop: 0, separate: 0, push: 0 };
  stage.goals[0].condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'x', targetId: '' },
    right: { kind: 'constant', value: 4.5 },
  };
  const plan = {
    launch: { x: stage.rules.launchLimit * 0.5, y: 0 },
    impulses: [],
    engineCommands: Array.from({ length: 64 }, (_, i) => ({
      id: `turn-${i}`,
      actorId: 'craft',
      time: ((i + 1) / 65) * 2,
      direction: { x: Math.cos(0.35), y: Math.sin(0.35) },
    })),
  };
  const template = {
    id: 'many',
    label: 'many',
    plan,
    parameters: searchParameters(stage, plan).map((p) => ({
      ...p,
      enabled: p.key.endsWith('.angle'),
    })),
  };
  const values = template.parameters
    .filter((p) => p.enabled)
    .map((p) => (p.value - p.min) / (p.max - p.min));
  const original = structuredClone(template);
  const iterator = trajectoryAdjoint(stage, template, values, (v) => parameterPlan(template, v));
  let result;
  for (;;) {
    const next = iterator.next();
    if (next.done) {
      result = next.value;
      break;
    }
  }
  expect(result).toBeDefined();
  let denseTicks = 0;
  function objective(v: number[]) {
    const run = createRun(stage, parameterPlan(template, v));
    let score = 0;
    while (run.status === 'running' && run.time < 2 - 1e-8) {
      tick(run, stage, Math.min(0.1, 2 - run.time), stage.objects, false);
      denseTicks++;
      score = Math.max(score, trajectoryScore(stage, run));
    }
    return score;
  }
  const dense = values.map((_, i) => {
    const a = values.slice(),
      b = values.slice();
    a[i] += 1e-5;
    b[i] -= 1e-5;
    return (objective(a) - objective(b)) / 2e-5;
  });
  const error = Math.hypot(...dense.map((g, i) => g - result!.gradient[i]));
  expect(error / Math.max(1e-10, Math.hypot(...dense))).toBeLessThan(0.04);
  expect(result!.ticks).toBeLessThan(denseTicks * 0.6);
  expect(result!.gradient.some((v) => Math.abs(v) > 1e-6)).toBe(true);
  expect(template).toEqual(original);
}, 20000);

it('다른 물리 모델을 추측하지 않고 큰 기록/작은 문제는 안전하게 일반 탐색에 맡긴다', () => {
  const stage = blankStage(),
    plan = { launch: { x: 0, y: 0 }, impulses: [] };
  const template = { id: 'small', label: '', plan, parameters: searchParameters(stage, plan) };
  const iterator = trajectoryAdjoint(stage, template, [0], () => plan);
  expect(iterator.next()).toEqual({ done: true, value: undefined });
});

it('예약 시각의 국소 미분도 절대 시각 전 구간 차분과 일치한다', () => {
  const stage = blankStage();
  stage.bodies = [];
  stage.launchBodyId = undefined;
  stage.spawn = { position: { x: 3, y: 3 }, velocity: { x: 0, y: 0 }, placed: true };
  stage.rocket!.parts = stage.rocket!.parts.slice(0, 1);
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 2;
  stage.rules.commandLimits = { turn: 32, ignite: 0, stop: 0, separate: 0, push: 0 };
  stage.goals[0].condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'x', targetId: '' },
    right: { kind: 'constant', value: 4.5 },
  };
  const plan = {
    launch: { x: stage.rules.launchLimit * 0.5, y: 0 },
    impulses: [],
    engineCommands: Array.from({ length: 32 }, (_, i) => ({
      id: `turn-${i}`,
      actorId: 'craft',
      time: ((i + 1) / 33) * 2,
      direction: { x: Math.cos(0.25 + i * 0.03), y: Math.sin(0.25 + i * 0.03) },
    })),
  };
  const template = {
    id: 'times',
    label: '',
    plan,
    parameters: searchParameters(stage, plan).map((p) => ({
      ...p,
      enabled: p.key.endsWith('.time') || p.key.endsWith('.angle'),
    })),
  };
  let previous = 0;
  const values = template.parameters
    .filter((p) => p.enabled)
    .map((p) => {
      const lower = p.key.endsWith('.time') ? previous : p.min;
      if (p.key.endsWith('.time')) previous = p.value;
      return (p.value - lower) / (p.max - lower);
    });
  const iterator = trajectoryAdjoint(stage, template, values, (v) => parameterPlan(template, v));
  let result;
  for (;;) {
    const n = iterator.next();
    if (n.done) {
      result = n.value;
      break;
    }
  }
  expect(result).toBeDefined();
  const base = parameterPlan(template, values);
  const objective = (p: typeof base) => {
    const run = createRun(stage, p);
    let score = 0;
    while (run.status === 'running' && run.time < 2 - 1e-8) {
      tick(run, stage, Math.min(0.1, 2 - run.time), stage.objects, false);
      score = Math.max(score, trajectoryScore(stage, run));
    }
    return score;
  };
  for (const i of [1, 8, 17]) {
    const a = structuredClone(base),
      b = structuredClone(base),
      h = 2e-5;
    a.engineCommands![i].time += h;
    b.engineCommands![i].time -= h;
    const dense = ((objective(a) - objective(b)) / (2 * h)) * 2;
    const at = template.parameters
      .filter((p) => p.enabled)
      .findIndex((p) => p.key === `command.${i}.time`);
    expect(Math.abs(result!.gradient[at] - dense)).toBeLessThan(0.0001);
  }
}, 20000);

it('같은 후보 예산에서 한 변수씩의 수정이 놓치는 다변수 상승 기동을 찾는다', () => {
  const stage = blankStage();
  stage.bodies = [];
  stage.launchBodyId = undefined;
  stage.spawn = { position: { x: 3, y: 3 }, velocity: { x: 0, y: 0 }, placed: true };
  stage.rocket!.parts = stage.rocket!.parts.slice(0, 1);
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 2;
  stage.rules.commandLimits = { turn: 64, ignite: 0, stop: 0, separate: 0, push: 0 };
  stage.goals[0].condition = {
    kind: 'all',
    children: [
      {
        kind: 'compare',
        operator: 'gte',
        left: { kind: 'metric', metric: 'vx', targetId: '' },
        right: { kind: 'constant', value: 0.03 },
      },
      {
        kind: 'compare',
        operator: 'gte',
        left: { kind: 'metric', metric: 'vy', targetId: '' },
        right: { kind: 'constant', value: 0.05 },
      },
    ],
  };
  const plan = {
    launch: { x: stage.rules.launchLimit * 0.5, y: 0 },
    impulses: [],
    engineCommands: Array.from({ length: 64 }, (_, i) => ({
      id: `turn-${i}`,
      actorId: 'craft',
      time: ((i + 1) / 65) * 2,
      direction: { x: Math.cos(-0.6), y: Math.sin(-0.6) },
    })),
  };
  const template = {
    id: 'coupled',
    label: '',
    plan,
    parameters: searchParameters(stage, plan).map((p) => ({
      ...p,
      enabled: p.key.endsWith('.angle'),
    })),
  };
  const improved = [...searchSolutions(stage, template, 16, false)].at(-1)!;
  const baseline = [
    ...searchSolutions(stage, template, 16, false, undefined, undefined, { adjoint: false }),
  ].at(-1)!;
  expect(improved.sensitivity!.passes).toBeGreaterThan(0);
  expect(improved.successes).toBeGreaterThan(0);
  expect(baseline.successes).toBe(0);
  for (const family of improved.families)
    expect(execute(stage, family.representative).status).toBe('won');
}, 20000);
