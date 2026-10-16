import { expect, it } from 'vitest';
import { conditionDomain } from '../src/editor/condition-domain';
import { blankStage } from '../src/stages/factory';
import { execute } from '../src/world/engine';
import { createRun } from '../src/world/engine';
import { expressionValue } from '../src/world/expressions';
import { freshProgress } from '../src/world/goals';
import type { Expression, Condition } from '../src/world/conditions';

const x = { kind: 'metric', metric: 'x', targetId: '' } as const;
const c = (value: number): Expression => ({ kind: 'constant', value });
const compare = (left: Expression, operator: 'gte' | 'lte', value: number): Condition => ({
  kind: 'compare',
  left,
  operator,
  right: c(value),
});
function chain(depth: number) {
  let expression: Expression = x;
  for (let i = 0; i < depth; i++)
    expression = { kind: 'calculate', operation: 'add', args: [expression, c(1)] };
  const stage = blankStage();
  stage.goals[0].condition = {
    kind: 'all',
    children: [compare(expression, 'gte', 0), compare(x, 'lte', -depth - 1)],
  };
  return stage;
}

it('중첩 JSON 문자열 대신 작은 DAG 번호를 써 수식 깊이에 선형인 메모리를 사용한다', () => {
  for (const depth of [8, 16, 24, 32]) {
    const result = conditionDomain(chain(depth));
    expect(result.impossible).toBe(true);
    expect(result.work.symbolicNodes).toBeLessThan(depth + 8);
    expect(result.work.symbolicBytes).toBeLessThan(depth * 40 + 200);
    expect(result.work.expressions).toBeLessThan(depth * 12 + 100);
  }
});

it('같은 구조의 독립 JSON 식은 동일한 DAG 노드와 계산 결과를 공유한다', () => {
  const stage = blankStage();
  const expression: Expression = { kind: 'calculate', operation: 'add', args: [x, c(1)] };
  stage.goals[0].condition = {
    kind: 'all',
    children: Array.from({ length: 100 }, () => compare(structuredClone(expression), 'gte', 0)),
  };
  const result = conditionDomain(stage);
  expect(result.impossible).toBe(false);
  expect(result.work.symbolicNodes).toBeLessThan(8);
  expect(result.work.cacheHits).toBeGreaterThan(100);
});

it('공유 입력이 좁아지면 모든 상위 계산을 무효화하고 다른 분기의 캐시는 건드리지 않는다', () => {
  const stage = chain(16);
  const condition = stage.goals[0].condition;
  if (!('children' in condition)) throw Error('복합 조건이 필요합니다.');
  const children = condition.children;
  children.reverse();
  const result = conditionDomain(stage);
  expect(result.impossible).toBe(true);
  expect(result.work.invalidations).toBeGreaterThan(0);
});

it('다른 행위자·참조·시각 범위의 노드를 같은 값으로 캐시하지 않는다', () => {
  const stage = blankStage();
  stage.goals[0].condition = {
    kind: 'all',
    children: [
      compare(x, 'gte', 2),
      compare({ ...x, actorId: 'satellite' }, 'lte', -2),
      { kind: 'once', child: compare(x, 'lte', -3) },
    ],
  };
  expect(conditionDomain(stage).impossible).toBe(false);
  stage.goals.push({
    ...stage.goals[0],
    id: 'other',
    endTime: 100,
    condition: compare({ kind: 'metric', metric: 'time', targetId: '' }, 'gte', 50),
  });
  stage.rules.maxTime = 100;
  expect(conditionDomain(stage).impossible).toBe(false);
});

it('누적 덧셈을 재결합하지 않아 큰 수 소거에서 실제 성공하는 해를 보존한다', () => {
  const stage = blankStage();
  stage.bodies = [];
  stage.objects = [];
  stage.rocket = undefined;
  stage.launchBodyId = undefined;
  stage.spawn = { placed: true, position: { x: 1e16, y: 1 }, velocity: { x: 0, y: 0 } };
  stage.rules.worldRadius = 2e16;
  stage.goals[0].condition = {
    kind: 'all',
    children: [
      compare(x, 'gte', 1e16),
      compare(x, 'lte', 1e16),
      compare({ ...x, metric: 'y' }, 'gte', 1),
      compare({ ...x, metric: 'y' }, 'lte', 1),
      compare(
        { kind: 'calculate', operation: 'add', args: [x, { ...x, metric: 'y' }, c(-1e16)] },
        'lte',
        0,
      ),
    ],
  };
  expect(execute(stage, { launch: { x: 0, y: 0 }, impulses: [] }).status).toBe('won');
  expect(conditionDomain(stage).impossible).toBe(false);
});

it('실제 수식 평가기로 만든 혼합 비선형 해를 역전파로 잘못 제거하지 않는다', () => {
  let seed = 1729;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const make = (depth: number): Expression => {
    if (depth === 0) return next() < 0.5 ? x : { ...x, metric: 'y' };
    const operation = (['add', 'subtract', 'multiply', 'divide', 'abs', 'min', 'max'] as const)[
      Math.floor(next() * 7)
    ];
    return {
      kind: 'calculate',
      operation,
      args:
        operation === 'abs'
          ? [make(depth - 1)]
          : operation === 'divide'
            ? [make(depth - 1), c(0.1 + next())]
            : [make(depth - 1), make(depth - 1)],
    };
  };
  for (let i = 0; i < 200; i++) {
    const stage = blankStage(),
      a = (next() - 0.5) * 100,
      b = (next() - 0.5) * 100;
    stage.bodies = [];
    stage.objects = [];
    stage.rocket = undefined;
    stage.launchBodyId = undefined;
    stage.spawn = { placed: true, position: { x: a, y: b }, velocity: { x: 0, y: 0 } };
    const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
    const expression = make(4);
    const value = expressionValue(
      expression,
      { stage, run, before: run.position, dt: 0, previousTime: 0 },
      freshProgress(),
    );
    stage.goals[0].condition = {
      kind: 'all',
      children: [
        compare(x, 'gte', a),
        compare(x, 'lte', a),
        compare({ ...x, metric: 'y' }, 'gte', b),
        compare({ ...x, metric: 'y' }, 'lte', b),
        { kind: 'compare', operator: 'eq', left: expression, right: c(value) },
      ],
    };
    expect(conditionDomain(stage).impossible, `재현 시드 ${seed}`).toBe(false);
  }
});
