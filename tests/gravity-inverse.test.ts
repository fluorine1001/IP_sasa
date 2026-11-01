import { expect, it } from 'vitest';
import { gravityInverse } from './fixtures/gravity-inverse';
import { inverseProjection } from '../src/editor/inverse-projection';
import { parameterPlan, searchSolutions } from '../src/editor/solution-search';
import { execute } from '../src/world/engine';
import { searchParameters } from '../src/editor/solution-search';
import { newObject } from '../src/stages/factory';
import { defaultRocket } from '../src/world/rocket';

it('정적 다체 중력의 제어 성공 영역을 실제 엔진 판정과 연결한다', () => {
  const { stage, plan, template, seed } = gravityInverse();
  expect(execute(stage, parameterPlan(template, seed)).status).not.toBe('won');
  let model: ((u: number[]) => boolean) | undefined, pending: ((u: number[]) => number) | undefined;
  const representatives: number[][] = [];
  for (const report of inverseProjection(stage, template, seed, plan, (evaluate, compiled) => {
    model = evaluate;
    const residual = compiled.relation.evaluator([compiled.residual]);
    pending = (u) => residual({ u0: u[0] })[0];
  }))
    if (report.coordinates) representatives.push(report.coordinates);
  expect(model).toBeDefined();
  let wins = 0;
  for (let i = 0; i <= 40; i++) {
    const u = [i / 40],
      actual = execute(stage, parameterPlan(template, u)).status === 'won';
    expect(pending!(u)).toBe(0);
    expect(model!(u), JSON.stringify(u)).toBe(actual);
    wins += Number(actual);
  }
  expect(wins).toBeGreaterThan(0);
  expect(representatives.length).toBeGreaterThan(0);
  for (const u of representatives)
    expect(execute(stage, parameterPlan(template, u)).status).toBe('won');
}, 60000);

it('고정 예약 시계의 움직이는 천체는 공통 천체 모델로 계산한다', () => {
  const { stage, plan, template, seed } = gravityInverse(true);
  let model: ((u: number[]) => boolean) | undefined;
  const iterator = inverseProjection(stage, template, seed, plan, (evaluate) => (model = evaluate));
  while (!model && !iterator.next().done) {
    /* Compile only; do not spend a region budget here. */
  }
  iterator.return(undefined);
  expect(model).toBeDefined();
  for (const p of [0, 0.2, 0.4, 0.45, 0.5, 0.6, 1])
    expect(model!([p])).toBe(execute(stage, parameterPlan(template, [p])).status === 'won');
});

it('상호 중력 천체와 시험 질점의 고정 시계도 실제 천체 적분 상태를 사용한다', () => {
  const { stage, plan, template, seed } = gravityInverse();
  stage.bodies[0].dynamic = { velocity: { x: 0.1, y: -0.2 } };
  stage.bodies[1].dynamic = { velocity: { x: -0.05, y: 0.1 } };
  stage.objects.push({
    ...newObject('station'),
    id: 'probe',
    physicalRadius: 0,
    position: { x: 5, y: 0 },
    dynamic: { velocity: { x: -0.2, y: 0.1 } },
  });
  const condition = stage.goals[0].condition;
  if (condition.kind !== 'all') throw Error('Fixture condition changed');
  for (const child of condition.children.slice(1)) {
    if (child.kind !== 'compare' || child.left.kind !== 'metric' || child.right.kind !== 'constant')
      throw Error('Fixture leaf changed');
    child.left.targetId = 'probe';
    child.right.value -= 5;
  }
  let model: ((u: number[]) => boolean) | undefined;
  const iterator = inverseProjection(stage, template, seed, plan, (evaluate) => (model = evaluate));
  while (!model && !iterator.next().done) {
    /* Compile only. */
  }
  iterator.return(undefined);
  expect(model).toBeDefined();
  for (let i = 0; i <= 20; i++)
    expect(model!([i / 20]), String(i)).toBe(
      execute(stage, parameterPlan(template, [i / 20])).status === 'won',
    );
});

it('정적 다체 중력에서는 연속 예약 시각도 seed에 고정하지 않는다', () => {
  const { stage } = gravityInverse();
  stage.rules.maxTime =
    stage.rules.timelineDuration =
    stage.audit.timeLimit =
    stage.goals[0].endTime =
      0.06;
  stage.rules.maneuverBudget = 1;
  const condition = stage.goals[0].condition;
  if (condition.kind !== 'all') throw Error('Fixture condition changed');
  for (const [i, child] of condition.children.entries()) {
    if (child.kind !== 'compare' || child.right.kind !== 'constant')
      throw Error('Fixture leaf changed');
    child.right.value = [0.04, 1.22, 1.225][i];
  }
  const plan = {
    launch: { x: 0.1, y: 0 },
    impulses: [{ id: 'push', time: 0, vector: { x: 0.5, y: 0 } }],
  };
  const template = {
    id: 'gravity-time',
    label: '중력·가변 사건 시각',
    plan,
    parameters: searchParameters(stage, plan),
  };
  template.parameters.forEach((p) => (p.enabled = p.key.endsWith('.time')));
  let model: ((u: number[]) => boolean) | undefined;
  const iterator = inverseProjection(stage, template, [0], plan, (evaluate) => (model = evaluate));
  while (!model && !iterator.next().done) {
    /* Compile only. */
  }
  iterator.return(undefined);
  expect(model).toBeDefined();
  let wins = 0;
  for (let i = 0; i <= 20; i++) {
    const actual = execute(stage, parameterPlan(template, [i / 20])).status === 'won';
    wins += Number(actual);
    expect(model!([i / 20]), String(i)).toBe(actual);
  }
  expect(wins).toBeGreaterThan(0);
  expect(wins).toBeLessThan(21);
});

it('고정 자세 로켓은 표면 지지와 이륙을 실제 엔진과 동일하게 구분한다', () => {
  const { stage, plan } = gravityInverse();
  stage.bodies.length = 1;
  stage.bodies[0].mu = 0.0001;
  stage.launchBodyId = stage.bodies[0].id;
  stage.launchAngle = 0;
  stage.rocket = defaultRocket();
  stage.rules.maxTime =
    stage.rules.timelineDuration =
    stage.audit.timeLimit =
    stage.goals[0].endTime =
      0.03;
  const condition = stage.goals[0].condition;
  if (condition.kind !== 'all') throw Error('Fixture condition changed');
  for (const [i, child] of condition.children.entries()) {
    if (child.kind !== 'compare' || child.right.kind !== 'constant')
      throw Error('Fixture leaf changed');
    child.right.value = [0.02, 0.10501, 0.2][i];
  }
  const template = {
    id: 'pad',
    label: '지지·이륙',
    plan,
    parameters: searchParameters(stage, plan),
  };
  template.parameters.forEach((p) => (p.enabled = p.key === 'launch.power'));
  let model: ((u: number[]) => boolean) | undefined;
  const iterator = inverseProjection(stage, template, [0], plan, (evaluate) => (model = evaluate));
  while (!model && !iterator.next().done) {
    /* Compile only. */
  }
  iterator.return(undefined);
  expect(model).toBeDefined();
  let wins = 0;
  for (const p of [0, 0.01, 0.1, 0.2, 0.5, 0.8, 1]) {
    const actual = execute(stage, parameterPlan(template, [p])).status === 'won';
    wins += Number(actual);
    expect(model!([p]), String(p)).toBe(actual);
  }
  expect(wins).toBeGreaterThan(0);
  expect(wins).toBeLessThan(7);
});

it('제작소 탐색은 순방향 후보 예산 한 번으로 중력 역상 대표를 실제 검증한다', () => {
  const { stage, template } = gravityInverse();
  const result = [...searchSolutions(stage, template, 1, false)].at(-1)!;
  expect(result.evaluated).toBe(1);
  expect(result.projection?.cells).toBeLessThan(48);
  expect(result.projection?.regions).toBeGreaterThan(0);
  expect(result.families.length).toBeGreaterThan(0);
  expect(execute(stage, result.families[0].representative).status).toBe('won');
}, 60000);

it('공유 예산이 끝난 역산은 비행 중으로 잠기지 않고 동일 위치에서 재개된다', () => {
  const { stage, template } = gravityInverse(),
    quota = { remaining: 1 };
  const search = searchSolutions(stage, template, 8, false, quota);
  try {
    let paused;
    for (let i = 0; i < 200; i++) {
      const next = search.next();
      expect(next.done).toBe(false);
      if (next.value!.evaluated === 1 && !next.value!.pending) {
        paused = next.value;
        break;
      }
    }
    expect(paused).toBeDefined();
    const cells = paused!.projection!.cells;
    for (let i = 0; i < 3; i++) {
      const next = search.next();
      expect(next.value!.pending).toBe(false);
      expect(next.value!.projection!.cells).toBe(cells);
      expect(next.value!.evaluated).toBe(1);
    }
    quota.remaining = 1;
    let resumed = false;
    for (let i = 0; i < 200; i++) {
      const next = search.next();
      if (next.done) break;
      if (next.value.evaluated > 1) {
        resumed = true;
        break;
      }
    }
    expect(resumed).toBe(true);
  } finally {
    search.return(undefined);
  }
}, 60000);

it('접촉 이후 미컴파일 전이는 불가능으로 지우지 않고 잔여 관계로 남긴다', () => {
  const { stage, plan, template, seed } = gravityInverse();
  stage.spawn.position = { x: 0.1, y: 0 };
  let residual: ((u: number[]) => number) | undefined;
  const iterator = inverseProjection(stage, template, seed, plan, (_, model) => {
    const evaluate = model.relation.evaluator([model.residual]);
    residual = (u) => evaluate({ u0: u[0] })[0];
  });
  while (!residual && !iterator.next().done) {
    /* Compile only. */
  }
  iterator.return(undefined);
  expect(residual).toBeDefined();
  expect(residual!([0])).toBe(1);
});
