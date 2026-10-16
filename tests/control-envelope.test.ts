import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { controlEnvelope } from '../src/editor/control-envelope';
import { conditionDomain } from '../src/editor/condition-domain';
import { globalSearch } from '../src/editor/global-search';
import { createRun, tick } from '../src/world/engine';
import type { Condition } from '../src/world/conditions';

function freeStage() {
  const stage = blankStage();
  stage.bodies = [];
  stage.objects = [];
  stage.launchBodyId = undefined;
  stage.spawn = { position: { x: 3, y: 2 }, velocity: { x: 0.1, y: -0.2 }, placed: true };
  stage.rules.worldRadius = 100;
  stage.rules.maxTime = 2;
  stage.goals[0].endTime = 2;
  stage.rules.commandLimits = { push: 32 };
  return stage;
}
const atLeast = (metric: string, value: number): Condition => ({
  kind: 'compare',
  operator: 'gte',
  left: { kind: 'metric', metric, targetId: '' },
  right: { kind: 'constant', value },
});

it('허용한 모든 예약 순서·실수 시각을 한 경계로 감싸고 불가능한 목표는 실제 비행 없이 제외한다', () => {
  const stage = freeStage();
  stage.rocket = undefined;
  stage.goals[0].condition = atLeast('x', 1000);
  const envelope = controlEnvelope(stage)!;
  expect(conditionDomain(stage, { metricRange: envelope.metricRange }).impossible).toBe(true);
  const result = [...globalSearch(stage, [], 128)].at(-1)!;
  expect(result.evaluated).toBe(0);
  expect(result.proof?.kind).toBe('control-envelope');
  expect(result.continuable).toBe(false);
});

it('순간 추진은 예약 개수가 아니라 전체 Δv 예산으로 감싼다', () => {
  const stage = freeStage();
  stage.rocket = undefined;
  stage.rules.launchLimit = 0.5;
  stage.rules.maneuverBudget = 0.2;
  const envelope = controlEnvelope(stage)!;
  expect(envelope.deltaV.hi).toBeCloseTo(0.70000002, 10);
  const hi = envelope.metricRange({ kind: 'metric', metric: 'x', targetId: '' }, 2)!.hi;
  expect(hi).toBeGreaterThanOrEqual(4.6);
  expect(hi).toBeLessThan(4.602);
});

it('실제 다단·회전·탑재체 분리 비행은 연속 영역 경계를 벗어나지 않는다', () => {
  const stage = freeStage();
  stage.rules.maxTime = 5;
  stage.rocket!.payloads = [{ id: 'sat', name: '위성', mass: 0.2, area: 0, releaseSpeed: 0.04 }];
  stage.goals[0].condition = atLeast('x', 1000);
  const envelope = controlEnvelope(stage)!;
  for (let i = 0; i < 16; i++) {
    const a = i * 0.73;
    const run = createRun(stage, {
      launch: { x: (stage.rules.launchLimit * (i + 1)) / 16, y: 0 },
      impulses: [],
      engineCommands: [
        { id: 'turn', actorId: 'craft', time: 0.13, direction: { x: Math.cos(a), y: Math.sin(a) } },
        { id: 'sep', actorId: 'craft', time: 1.1, separate: true },
        { id: 'ignite', actorId: 'craft', time: 1.12, throttle: 1 },
        { id: 'release', actorId: 'craft', time: 1.5, releasePayload: 'sat' },
        { id: 'turn-again', actorId: 'craft', time: 1.6, direction: { x: -1, y: 0.2 } },
      ],
    });
    while (run.status === 'running' && run.time < 5 - 1e-8) {
      tick(run, stage, 0.1, [], false);
      for (const [metric, value] of Object.entries({
        x: run.position.x,
        y: run.position.y,
        vx: run.velocity.x,
        vy: run.velocity.y,
      })) {
        const r = envelope.metricRange({ kind: 'metric', metric, targetId: '' }, run.time)!;
        expect(value).toBeGreaterThanOrEqual(r.lo);
        expect(value).toBeLessThanOrEqual(r.hi);
      }
    }
  }
});

it('서로 다른 시간의 상태·서로 다른 행위자를 한 순간으로 합치지 않는다', () => {
  const stage = freeStage();
  stage.goals[0].condition = {
    kind: 'sequence',
    children: [
      atLeast('x', 3.1),
      {
        ...atLeast('x', 3.1),
        operator: 'lte',
      } as Condition,
    ],
  };
  const envelope = controlEnvelope(stage)!;
  expect(conditionDomain(stage, { metricRange: envelope.metricRange }).impossible).toBe(false);
  expect(
    envelope.metricRange(
      { kind: 'metric', metric: 'x', actorId: 'not-yet-released', targetId: '' },
      2,
    ),
  ).toBeUndefined();
});

it('중력·접촉·시간 무제한을 유한 무중력 증명으로 오인하지 않는다', () => {
  const stage = blankStage();
  expect(controlEnvelope(stage)).toBeUndefined();
  const free = freeStage();
  free.rules.maxTimeUnlimited = true;
  free.goals[0].endTimeUnlimited = true;
  free.audit.timeLimit = 0.1;
  const envelope = controlEnvelope(free)!;
  free.goals[0].condition = atLeast('x', 10000);
  expect(conditionDomain(free, { metricRange: envelope.metricRange }).impossible).toBe(false);
});

it('제곱의 비음수성과 역전파로 실수 전체의 불가능한 입력 영역을 제외한다', () => {
  const stage = blankStage();
  const x = { kind: 'metric', metric: 'x', targetId: '' } as const;
  stage.goals[0].condition = {
    kind: 'all',
    children: [
      atLeast('x', 2),
      {
        kind: 'compare',
        operator: 'lte',
        left: { kind: 'calculate', operation: 'multiply', args: [x, x] },
        right: { kind: 'constant', value: 1 },
      },
    ],
  };
  expect(conditionDomain(stage).impossible).toBe(true);
});

it('서로의 입력 구간을 좁혀야만 드러나는 비선형 모순을 비행 표본 없이 푼다', () => {
  const stage = blankStage();
  const x = { kind: 'metric', metric: 'x', targetId: '' } as const;
  const y = { kind: 'metric', metric: 'y', targetId: '' } as const;
  const square = (arg: typeof x | typeof y): Condition => ({
    kind: 'compare',
    operator: 'lte',
    left: { kind: 'calculate', operation: 'multiply', args: [arg, arg] },
    right: { kind: 'constant', value: 1 },
  });
  stage.goals[0].condition = {
    kind: 'all',
    children: [
      square(x),
      square(y),
      {
        kind: 'compare',
        operator: 'gte',
        left: { kind: 'calculate', operation: 'multiply', args: [x, y] },
        right: { kind: 'constant', value: 2 },
      },
    ],
  };
  expect(conditionDomain(stage).impossible).toBe(true);
});

it('차이와 합의 역전파는 별개인 두 실수 변수 사이의 모순을 찾는다', () => {
  const stage = blankStage();
  const x = { kind: 'metric', metric: 'x', targetId: '' } as const;
  const y = { kind: 'metric', metric: 'y', targetId: '' } as const;
  stage.goals[0].condition = {
    kind: 'all',
    children: [
      atLeast('x', 0),
      atLeast('y', 0),
      {
        kind: 'compare',
        operator: 'lte',
        left: { kind: 'calculate', operation: 'add', args: [x, y] },
        right: { kind: 'constant', value: 1 },
      },
      {
        kind: 'compare',
        operator: 'gte',
        left: { kind: 'calculate', operation: 'subtract', args: [x, y] },
        right: { kind: 'constant', value: 2 },
      },
    ],
  };
  expect(conditionDomain(stage).impossible).toBe(true);
});

it('제곱·제로 곱·나눗셈·음수·반올림 경계에 실제로 존재하는 해는 제거하지 않는다', () => {
  const x = { kind: 'metric', metric: 'x', targetId: '' } as const;
  const y = { kind: 'metric', metric: 'y', targetId: '' } as const;
  for (let i = -50; i <= 50; i++) {
    const stage = blankStage(),
      a = i / 13,
      b = (i + 3) / 7;
    stage.goals[0].condition = {
      kind: 'all',
      children: [
        { ...atLeast('x', a), operator: 'eq' } as Condition,
        { ...atLeast('y', b), operator: 'eq' } as Condition,
        ...(['add', 'subtract', 'multiply', 'divide'] as const).flatMap(
          (operation): Condition[] => {
            if (operation === 'divide' && b === 0) return [];
            const value =
              operation === 'add'
                ? a + b
                : operation === 'subtract'
                  ? a - b
                  : operation === 'multiply'
                    ? a * b
                    : a / b;
            return [
              {
                kind: 'compare',
                operator: 'eq',
                left: { kind: 'calculate', operation, args: [x, y] },
                right: { kind: 'constant', value },
              },
            ];
          },
        ),
      ],
    };
    expect(conditionDomain(stage).impossible, `입력 ${a}, ${b}`).toBe(false);
  }
});

it('무한한 같은 시각 미세 추진은 유한 부동소수점 누적 증명으로 제외하지 않는다', () => {
  const stage = freeStage();
  stage.rocket = undefined;
  stage.rules.commandLimits = undefined;
  expect(controlEnvelope(stage)!.proofReady).toBe(false);
});

it('다양한 실수 시각·방향의 전체 추진 예약을 실제 엔진으로 대조한다', () => {
  const stage = freeStage();
  stage.rocket = undefined;
  stage.goals[0].condition = atLeast('x', 1000);
  const envelope = controlEnvelope(stage)!;
  for (let i = 0; i < 40; i++) {
    const angle = i * 1.93;
    const run = createRun(stage, {
      launch: {
        x: Math.cos(angle) * stage.rules.launchLimit,
        y: Math.sin(angle) * stage.rules.launchLimit,
      },
      impulses: Array.from({ length: 16 }, (_, n) => ({
        id: `push-${n}`,
        time: 2 * ((n * 0.6180339887498948 + i * 0.31) % 1),
        vector: {
          x: (Math.cos(n * 3.17 + angle) * stage.rules.maneuverBudget) / 16,
          y: (Math.sin(n * 3.17 + angle) * stage.rules.maneuverBudget) / 16,
        },
      })),
    });
    while (run.status === 'running') {
      tick(run, stage, 0.1, [], false);
      for (const [metric, value] of Object.entries({
        x: run.position.x,
        y: run.position.y,
        vx: run.velocity.x,
        vy: run.velocity.y,
      })) {
        const range = envelope.metricRange({ kind: 'metric', metric, targetId: '' }, run.time)!;
        expect(value).toBeGreaterThanOrEqual(range.lo);
        expect(value).toBeLessThanOrEqual(range.hi);
      }
    }
  }
});

it('사칙연산 공유식을 역전파하고 순서를 바꿔도 같은 연속 영역을 제외한다', () => {
  const stage = blankStage();
  const x = { kind: 'metric', metric: 'x', targetId: '' } as const;
  const y = { kind: 'metric', metric: 'y', targetId: '' } as const;
  const conditions: Condition[] = [
    atLeast('x', 2),
    atLeast('y', 3),
    {
      kind: 'compare',
      operator: 'lte',
      left: { kind: 'calculate', operation: 'add', args: [x, y] },
      right: { kind: 'constant', value: 4 },
    },
  ];
  for (let i = 0; i < 3; i++) {
    stage.goals[0].condition = { kind: 'all', children: conditions };
    expect(conditionDomain(stage).impossible).toBe(true);
    conditions.push(conditions.shift()!);
  }
});
