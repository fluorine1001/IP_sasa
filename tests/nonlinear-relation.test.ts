import { expect, it } from 'vitest';
import { NonlinearRelation } from '../src/editor/research/nonlinear-relation';
import { attraction, rk4 } from '../src/physics/nonlinear-kernel';
import { emptyStage, newBody, newGoal } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';

it('비선형 목표의 역상에서 떨어진 두 성공 가지를 합쳐 버리거나 하나만 선택하지 않는다', () => {
  const relation = new NonlinearRelation(),
    x = relation.input('control');
  const result = relation.contract({ control: [{ lo: -10, hi: 10 }] }, [
    { term: relation.multiply(x, x), range: [{ lo: 4, hi: 9 }] },
  ]);
  expect(result.empty).toBe(false);
  expect(result.fixedPoint).toBe(true);
  const domain = result.domains.control;
  expect(domain.length).toBe(2);
  expect(domain[0].hi).toBeCloseTo(-2, 12);
  expect(domain[0].lo).toBeCloseTo(-3, 12);
  expect(domain[1].lo).toBeCloseTo(2, 12);
  expect(domain[1].hi).toBeCloseTo(3, 12);
  for (let i = -1000; i <= 1000; i++) {
    const value = i / 100;
    if (value * value >= 4 && value * value <= 9)
      expect(domain.some((d) => d.lo <= value && value <= d.hi)).toBe(true);
  }
  expect(domain.some((d) => d.lo <= 0 && 0 <= d.hi)).toBe(false);
});

it('반복 변수의 의존성은 역방향 구간 미분과 뉴턴 수축으로 풀고 변수별 재비행을 하지 않는다', () => {
  const relation = new NonlinearRelation(),
    x = relation.input('x');
  let repeated = x;
  for (let i = 0; i < 8; i++)
    repeated = relation.add(
      relation.add(repeated, repeated),
      relation.multiply(repeated, relation.literal(-1)),
    );
  const targets = [{ term: repeated, range: [{ lo: 1, hi: 2 }] }];
  const bounds = { x: [{ lo: -100, hi: 100 }] };
  const baseline = relation.contract(bounds, targets, { newton: false });
  const inverse = relation.contract(bounds, targets, { newton: true });
  expect(inverse.empty).toBe(false);
  expect(inverse.domains.x[0].lo).toBeCloseTo(1, 9);
  expect(inverse.domains.x[0].hi).toBeCloseTo(2, 9);
  expect(inverse.statistics.newtonVisits).toBeGreaterThan(0);
  expect(baseline.domains.x[0].lo).toBe(-100);
  expect(inverse.statistics.visits).toBeLessThan(relation.statistics.nodes * 8);
});

it('큰 제어 집합의 모든 미분을 공유 DAG로 계산하며 무관한 영역과 떨어진 가지를 보존한다', () => {
  for (const count of [32, 128]) {
    const relation = new NonlinearRelation();
    const inputs = Array.from({ length: count }, (_, i) => relation.input('u' + i));
    let root = inputs[0];
    for (const term of inputs.slice(1))
      root = relation.add(root, relation.add(term, relation.multiply(term, relation.literal(-1))));
    const bounds = Object.fromEntries(inputs.map((_, i) => ['u' + i, [{ lo: -100, hi: 100 }]]));
    bounds.unused = [
      { lo: -4, hi: -3 },
      { lo: 3, hi: 4 },
    ];
    const result = relation.contract(bounds, [{ term: root, range: [{ lo: 1, hi: 2 }] }]);
    expect(result.empty).toBe(false);
    expect(result.domains.u0[0].lo).toBeCloseTo(1, 8);
    expect(result.domains.u0.at(-1)!.hi).toBeCloseTo(2, 8);
    expect(result.domains.unused).toEqual(bounds.unused);
    expect(result.statistics.visits).toBeLessThan(relation.statistics.nodes * 12);
    for (let i = 1; i < count; i++) expect(result.domains['u' + i]).toEqual(bounds['u' + i]);
  }
  const relation = new NonlinearRelation(),
    x = relation.input('x');
  const result = relation.contract(
    {
      x: [
        { lo: -2, hi: -1 },
        { lo: 1, hi: 2 },
      ],
    },
    [{ term: relation.cube(x), range: [{ lo: 3.375, hi: 3.375 }] }],
  );
  expect(result.empty).toBe(false);
  expect(result.domains.x.some((d) => d.lo <= 1.5 && 1.5 <= d.hi)).toBe(true);
});

it('무작위 비선형 DAG의 실제 만족점을 수축으로 없애지 않는다', () => {
  let seed = 40216;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let example = 0; example < 100; example++) {
    const relation = new NonlinearRelation(),
      terms = [relation.input('x'), relation.input('y'), relation.literal(0.25)];
    for (let i = 0; i < 12; i++) {
      const a = terms[next() % terms.length],
        b = terms[next() % terms.length];
      switch (next() % 6) {
        case 0:
          terms.push(relation.add(a, b));
          break;
        case 1:
          terms.push(relation.multiply(a, b));
          break;
        case 2:
          terms.push(
            relation.divide(a, relation.add(relation.multiply(b, b), relation.literal(1))),
          );
          break;
        case 3:
          terms.push(relation.cube(relation.divide(a, relation.literal(4))));
          break;
        case 4:
          terms.push(relation.hypot(a, b));
          break;
        default:
          terms.push(relation.max(a, b));
      }
    }
    const point = { x: ((next() % 7) - 3) / 4, y: ((next() % 7) - 3) / 4 };
    const value = relation.evaluator([terms.at(-1)!])(point)[0],
      tolerance = Math.max(1, Math.abs(value)) * 1e-4;
    const result = relation.contract({ x: [{ lo: -1, hi: 1 }], y: [{ lo: -1, hi: 1 }] }, [
      { term: terms.at(-1)!, range: [{ lo: value - tolerance, hi: value + tolerance }] },
    ]);
    expect(result.empty, 'case ' + example).toBe(false);
    expect(
      result.domains.x.some((d) => d.lo <= point.x && point.x <= d.hi),
      'x case ' + example,
    ).toBe(true);
    expect(
      result.domains.y.some((d) => d.lo <= point.y && point.y <= d.hi),
      'y case ' + example,
    ).toBe(true);
  }
});

it('실제 중력 RK4의 목표 속도에서 발사 값·실행 시각 영역을 역전파하고 실제 성공을 보존한다', () => {
  const relation = new NonlinearRelation(),
    c = (v: number) => relation.literal(v);
  const start = { x: c(1), y: c(0.2) },
    speed = { x: relation.input('launch-x'), y: c(0) };
  const [position, velocity] = rk4(
    relation,
    (p) => attraction(relation, p, { x: c(0), y: c(0) }, c(0.3), c(0.02)),
    start,
    speed,
    c(0),
    relation.input('duration'),
  );
  const result = relation.contract(
    { 'launch-x': [{ lo: -0.5, hi: 0.5 }], duration: [{ lo: 0.005, hi: 0.01 }] },
    [{ term: velocity.x, range: [{ lo: 0.2, hi: 0.25 }] }],
  );
  expect(result.empty).toBe(false);
  expect(result.fixedPoint).toBe(true);
  expect(result.domains['launch-x'][0].lo).toBeGreaterThan(0.19);
  expect(result.domains['launch-x'].at(-1)!.hi).toBeLessThan(0.26);
  const stage = emptyStage(),
    body = newBody();
  body.radius = 0.1;
  body.mu = 0.3;
  stage.bodies = [body];
  stage.spawn = { position: { x: 1, y: 0.2 }, velocity: { x: 0, y: 0 }, placed: true };
  stage.rules.launchLimit = 1;
  stage.rules.maxTime = 0.05;
  const goal = newGoal();
  goal.condition = {
    kind: 'all',
    children: [
      {
        kind: 'compare',
        left: { kind: 'metric', metric: 'vx', targetId: '' },
        operator: 'gte',
        right: { kind: 'constant', value: 0.2 },
      },
      {
        kind: 'compare',
        left: { kind: 'metric', metric: 'vx', targetId: '' },
        operator: 'lte',
        right: { kind: 'constant', value: 0.25 },
      },
    ],
  };
  stage.goals = [goal];
  const evaluate = relation.evaluator([position.x, position.y, velocity.x, velocity.y]);
  let wins = 0;
  for (let i = 0; i <= 40; i++)
    for (let j = 0; j <= 6; j++) {
      const launch = -0.5 + i / 40,
        duration = 0.005 + j / 1200;
      const run = createRun(stage, { launch: { x: launch, y: 0 }, impulses: [] });
      tick(run, stage, duration, [], false);
      expect(evaluate({ 'launch-x': launch, duration })).toEqual([
        run.position.x,
        run.position.y,
        run.velocity.x,
        run.velocity.y,
      ]);
      if (run.status === 'won') {
        wins++;
        expect(result.domains['launch-x'].some((d) => d.lo <= launch && launch <= d.hi)).toBe(true);
        expect(result.domains.duration.some((d) => d.lo <= duration && duration <= d.hi)).toBe(
          true,
        );
      }
    }
  expect(wins).toBeGreaterThan(0);
});
