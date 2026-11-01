import { expect, it } from 'vitest';
import { emptyStage, newGoal } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';
import { searchFitness } from '../src/editor/search-fitness';
import { observedExpression } from '../src/world/expressions';
import { searchTemplates, searchSolutions } from '../src/editor/solution-search';
import { execute } from '../src/world/engine';
import { defaultRocket } from '../src/world/rocket';
import { newBody } from '../src/stages/factory';
import { searchParameters } from '../src/editor/solution-search';
import { issues } from '../src/stages/validation';
import { windowSearchStage } from './fixtures/window-search';
import { inverseProjection } from '../src/editor/inverse-projection';
import { parameterPlan } from '../src/editor/solution-search';
import { auditStage } from '../src/editor/audit';

it('제작소의 탐색 점수는 실제 구간 통계의 오차를 구분하며 판정 기억을 수정하지 않는다', () => {
  const stage = emptyStage();
  stage.rules.launchLimit = 2;
  const left = {
    kind: 'window' as const,
    operation: 'mean' as const,
    value: { kind: 'metric' as const, metric: 'speed', targetId: '' },
    domain: { kind: 'metric' as const, metric: 'time', targetId: '' },
    width: { kind: 'constant' as const, value: 0.02 },
  };
  const goal = {
    ...newGoal(),
    condition: {
      kind: 'compare' as const,
      left,
      operator: 'lte' as const,
      right: { kind: 'constant' as const, value: 0.1 },
    },
  };
  stage.goals = [goal];
  const runs = [0.3, 1.5].map((speed) => {
    const run = createRun(stage, { launch: { x: speed, y: 0 }, impulses: [] });
    // The high-speed fixture also needs a legal launcher.
    if (run.status !== 'running') throw Error(run.reason);
    tick(run, stage, 0.04, [], false);
    return run;
  });
  const before = runs.map((r) => structuredClone(r.goals));
  expect(searchFitness(stage, runs[0])).toBeGreaterThan(searchFitness(stage, runs[1]));
  expect(runs.map((r) => r.goals)).toEqual(before);
  const run = runs[0],
    progress = run.goals[goal.id];
  const value = observedExpression(
    left,
    { stage, run, before: run.position, dt: 0, previousTime: run.time },
    progress,
    'root.left',
  );
  expect(value).toBeCloseTo(0.3, 12);
  expect(run.goals).toEqual(before[0]);
});

it('실제 제작소 탐색이 좁은 구간 통계 성공 영역을 역산하여 대표 한 번의 비행으로 검증한다', () => {
  const stage = windowSearchStage();
  expect(issues(stage)).toEqual([]);
  const template = searchTemplates(stage).find((t) => t.label === '첫 출력만')!;
  template.parameters.forEach((p) => {
    p.enabled = p.key === 'launch.power';
  });
  const result = [...searchSolutions(stage, template, 1)].at(-1)!;
  expect(result.successes).toBe(1);
  expect(result.families).toHaveLength(1);
  expect(execute(stage, result.families[0].representative).status).toBe('won');
  expect(result.projection?.regions).toBeGreaterThan(0);
});

it('천체 없는 통계 임무도 제작소 자동 검사가 중단되지 않으며 가상의 천체 전략을 만들지 않는다', () => {
  const stage = windowSearchStage();
  stage.audit.samples = 16;
  const result = [...auditStage(stage)].at(-1)!;
  expect(result.done).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.simpleWins).not.toContain('천체를 향해 직진');
  expect(result.simpleWins).not.toContain('천체에서 멀어지기');
});

it('제작소 연결이 다단·부스터 독립 연소·위성 분리와 구간 연료 목표를 실제 엔진으로 검증한다', () => {
  const stage = emptyStage();
  stage.spawn.placed = true;
  stage.rules.maxTime = 0.05;
  stage.rules.timelineDuration = 0.05;
  stage.audit.timeLimit = 0.05;
  stage.rocket = defaultRocket();
  const lower = stage.rocket.parts[0];
  lower.fuelMass = 0.04;
  lower.thrust = 2;
  lower.exhaustSpeed = 1;
  stage.rocket.payloads = [{ id: 'sat', name: '위성', mass: 0.1, area: 0, releaseSpeed: 0.02 }];
  const statistic = {
    kind: 'window' as const,
    operation: 'mean' as const,
    value: { kind: 'metric' as const, metric: 'fuel', targetId: '', actorId: lower.id },
    domain: { kind: 'metric' as const, metric: 'time', targetId: '' },
    width: { kind: 'constant' as const, value: 0.01 },
  };
  stage.goals = [
    {
      ...newGoal(),
      endTime: 0.05,
      condition: {
        kind: 'all',
        children: [
          { kind: 'once', child: { kind: 'event', event: 'separation', targetId: lower.id } },
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'releasedPayloads', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 1 },
          },
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'throttle', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 0.2 },
          },
          {
            kind: 'compare',
            left: statistic,
            operator: 'gte',
            right: { kind: 'constant', value: 0.03 },
          },
          {
            kind: 'compare',
            left: statistic,
            operator: 'lte',
            right: { kind: 'constant', value: 0.035 },
          },
        ],
      },
    },
  ];
  const plan = {
    launch: { x: stage.rules.launchLimit, y: 0 },
    impulses: [],
    engineCommands: [
      { id: 's', time: 0.015, actorId: 'craft', separate: true },
      { id: 'b', time: 0.015, actorId: lower.id, throttle: 0.25 },
      { id: 'u', time: 0.021, actorId: 'craft', throttle: 0.3 },
      { id: 'p', time: 0.02, actorId: 'craft', releasePayload: 'sat' },
    ],
  };
  const template = {
    id: 'staged-window',
    label: '분리 후 연료',
    plan,
    parameters: searchParameters(stage, plan),
  };
  template.parameters.forEach((p) => {
    p.enabled = p.key === 'launch.power';
  });
  expect(issues(stage)).toEqual([]);
  let model: ((coordinates: number[]) => boolean) | undefined;
  [
    ...inverseProjection(stage, template, [1], plan, (evaluate) => {
      model = evaluate;
    }),
  ];
  for (const u of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5, 1])
    expect(model?.([u])).toBe(execute(stage, parameterPlan(template, [u])).status === 'won');
  expect(execute(stage, parameterPlan(template, [0.05])).status).toBe('won');
  const result = [...searchSolutions(stage, template, 1)].at(-1)!;
  expect(result.successes).toBe(1);
  expect(result.projection?.regions).toBeGreaterThan(0);
  expect(execute(stage, result.families[0].representative).status).toBe('won');
});

it('아직 컴파일하지 않은 표현식은 발사로 대체하지 않고 명시적 미지원 관계로 남는다', async () => {
  const { inverseSearch } = await import('../src/editor/inverse-search');
  for (const gravity of [false, true]) {
    const stage = windowSearchStage();
    if (gravity)
      stage.bodies = [{ ...newBody(), position: { x: -2, y: 0 }, radius: 0.1, mu: 0.01 }];
    stage.goals[0].condition = {
      kind: 'compare',
      left: {
        kind: 'calculate',
        operation: 'sin',
        args: [{ kind: 'metric', metric: 'time', targetId: '' }],
      },
      operator: 'gt',
      right: { kind: 'constant', value: 0 },
    };
    const template = searchTemplates(stage).find((t) => t.label === '첫 출력만')!;
    const result = [...inverseSearch(stage, [template], { budget: 16 })].at(-1)!;
    expect(result.evaluated).toBe(0);
    expect(result.families).toEqual([]);
    expect(result.inverse?.unsupported).toBeGreaterThan(0);
    expect(result.inverse?.issues.join(' ')).toContain('sin');
    expect(result.inverse?.complete).toBe(false);
  }
});
