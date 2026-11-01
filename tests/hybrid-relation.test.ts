import { expect, it } from 'vitest';
import {
  NonlinearRelation,
  NonlinearRelationLimit,
} from '../src/editor/research/nonlinear-relation';
import {
  burn,
  engineSetting,
  separationReset,
  capsuleSweep,
  flightOutcome,
  hybridFloat,
} from '../src/physics/hybrid-kernel';
import { GoalHistory } from '../src/editor/research/goal-history';
import { sweepHull, hullSize } from '../src/world/hull';
import {
  defaultRocket,
  rocketMass,
  poweredStep,
  separate,
  controlEngine,
} from '../src/world/rocket';
import { emptyStage, newGoal } from '../src/stages/factory';
import { createRun } from '../src/world/engine';
import { evaluateCondition, type Condition } from '../src/world/conditions';
import { freshProgress } from '../src/world/goals';
import { logPoint } from '../src/editor/research/log-domain';
import { RocketResources } from '../src/editor/research/rocket-resources';
import { releasePayload } from '../src/world/rocket';
import { expressionValue } from '../src/world/expressions';
import { updateGoals } from '../src/world/goals';
import { newBody } from '../src/stages/factory';
import { tick } from '../src/world/engine';
import { attraction, rk4 } from '../src/physics/nonlinear-kernel';

const point = (value: number) => [{ lo: value, hi: value }];
it('다른 관계의 술어 혼입과 자원 초과를 성공·빈 집합으로 둔갑시키지 않는다', () => {
  const a = new NonlinearRelation(),
    b = new NonlinearRelation(),
    x = a.input('x');
  expect(() => b.lt(x, x)).toThrow('Foreign');
  expect(() => b.lte(x, x)).toThrow('Foreign');
  const limited = new NonlinearRelation({ nodes: 1 });
  limited.input('x');
  expect(() => limited.literal(0)).toThrow(NonlinearRelationLimit);
});

it('미정의 분기와 비선형 연산을 섞어도 알려진 만족점의 모드를 없애지 않는다', () => {
  let seed = 56721;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 2 ** 32;
  };
  for (let sample = 0; sample < 48; sample++) {
    const r = new NonlinearRelation(),
      x = r.input('x'),
      y = r.input('y'),
      z = r.literal(0),
      one = r.literal(1);
    let value = r.select(r.lt(x, z), r.sqrt(x), r.add(x, one));
    for (let i = 0; i < 8; i++) {
      const safeLog = r.log(r.add(one, r.multiply(y, y)));
      value = r.select(
        r.lt(y, r.literal(random())),
        r.max(value, safeLog),
        r.min(r.add(value, safeLog), r.literal(5)),
      );
    }
    // The positive known point is valid. Its search box also contains undefined
    // sqrt states, which must not invalidate the other mode.
    const assignment = { x: 0.1 + random(), y: random() * 2 - 1 },
      result = r.evaluator([value])(assignment)[0];
    const contracted = r.contract({ x: [{ lo: -1, hi: 2 }], y: [{ lo: -1, hi: 1 }] }, [
      { term: value, range: [{ lo: result - 1e-5, hi: result + 1e-5 }] },
    ]);
    expect(contracted.empty).toBe(false);
    for (const [key, v] of Object.entries(assignment))
      expect(contracted.domains[key].some((d) => d.lo <= v && v <= d.hi)).toBe(true);
  }
});

it('모드가 전체 입력 껍질에서 고정된 경우에만 분기 내부를 구간 뉴턴으로 역산한다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x');
  let repeated = x;
  for (let i = 0; i < 8; i++) repeated = r.subtract(r.add(repeated, repeated), repeated);
  const selected = r.select(r.lt(x, r.literal(0)), r.log(r.literal(2)), repeated);
  const inverse = r.contract({ x: [{ lo: 1, hi: 3 }] }, [
    { term: selected, range: [{ lo: 1.5, hi: 2 }] },
  ]);
  expect(inverse.statistics.newtonVisits).toBeGreaterThan(0);
  expect(inverse.domains.x[0].lo).toBeCloseTo(1.5, 9);
  expect(inverse.domains.x.at(-1)!.hi).toBeCloseTo(2, 9);
  const jumping = r.select(r.lt(x, r.literal(0)), x, r.add(x, r.literal(10)));
  const crossing = r.contract({ x: [{ lo: -2, hi: 2 }] }, [
    { term: jumping, range: [{ lo: 10.5, hi: 11 }] },
  ]);
  expect(crossing.statistics.newtonPasses).toBe(0);
  expect(crossing.empty).toBe(false);
  expect(crossing.domains.x.some((d) => d.lo <= 0.75 && 0.75 <= d.hi)).toBe(true);
});
it('선택하지 않은 부분식이 정의되지 않아도 유효한 가지의 입력을 제거하지 않는다', () => {
  for (const operation of ['sqrt', 'log', 'divide'] as const) {
    const r = new NonlinearRelation(),
      x = r.input('x');
    const partial =
      operation === 'sqrt' ? r.sqrt(x) : operation === 'log' ? r.log(x) : r.divide(r.literal(1), x);
    const value = r.select(r.lt(r.literal(0), x), partial, r.literal(0));
    const result = r.contract({ x: [{ lo: -1, hi: 1 }] }, [{ term: value, range: point(0) }]);
    expect(result.empty).toBe(false);
    for (const valid of [-1, -0.5, 0])
      expect(result.domains.x.some((d) => d.lo <= valid && valid <= d.hi)).toBe(true);
  }
});
it('로그의 실수 구간은 구현체 Math.log 정확도를 가정하지 않고 극단 입력까지 둘러싼다', () => {
  for (const value of [Number.MIN_VALUE, 1e-300, 0.1, 0.5, 1, 2, 10, 1e300, Number.MAX_VALUE]) {
    const range = logPoint(value);
    expect(range.lo).toBeLessThanOrEqual(Math.log(value));
    expect(range.hi).toBeGreaterThanOrEqual(Math.log(value));
    expect(range.hi - range.lo).toBeLessThan(1e-9);
  }
});
it('연료 소진과 점화 제한 양쪽 모드가 같은 관계에 남고 실제 엔진의 경계와 일치한다', () => {
  const r = new NonlinearRelation(),
    fuel = r.input('fuel'),
    throttle = r.input('throttle');
  const config = {
    mass: r.add(r.literal(1), fuel),
    fuel,
    throttle,
    thrust: r.literal(2),
    exhaustSpeed: r.literal(1),
    dt: r.literal(0.01),
  };
  const step = burn(r, config),
    setting = engineSetting(r, fuel, r.literal(0), r.literal(1), r.literal(2), throttle);
  const evaluate = r.evaluator([
    step.fuel,
    step.delta,
    step.throttle,
    setting.accepted,
    setting.ignitions,
  ]);
  for (const f of [0, 1e-10, 0.005, 0.01, 0.02, 0.03])
    for (const t of [0, 0.25, 1]) {
      const stage = emptyStage();
      stage.rocket = defaultRocket();
      const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
      const part = stage.rocket.parts[0];
      part.thrust = 2;
      part.exhaustSpeed = 1;
      run.rocket!.fuel[0] = f;
      run.rocket!.throttle = t;
      const before = rocketMass(stage, run),
        vx = run.velocity.x;
      const actual = burn(hybridFloat, {
        mass: before,
        fuel: f,
        throttle: t,
        thrust: 2,
        exhaustSpeed: 1,
        dt: 0.01,
      });
      poweredStep(run, stage, 0.01);
      expect(run.rocket!.fuel[0]).toBe(actual.fuel);
      expect(run.rocket!.throttle).toBe(actual.throttle);
      expect(run.velocity.x - vx).toBe(actual.delta);
      const expected = burn(hybridFloat, {
        ...config,
        mass: 1 + f,
        fuel: f,
        throttle: t,
        thrust: 2,
        exhaustSpeed: 1,
        dt: 0.01,
      });
      expect(evaluate({ fuel: f, throttle: t }).slice(0, 3)).toEqual([
        expected.fuel,
        expected.delta,
        expected.throttle,
      ]);
    }
  const inverse = r.contract({ fuel: [{ lo: 0, hi: 0.1 }], throttle: [{ lo: 0, hi: 1 }] }, [
    { term: step.fuel, range: point(0) },
  ]);
  expect(inverse.empty).toBe(false);
  expect(inverse.domains.fuel.at(-1)!.hi).toBeLessThan(0.020001);
  // Remaining fuel is continuous (fuel-min(fuel,spent)); its generalized
  // derivative enclosure is usable even though the later throttle is discontinuous.
  expect(inverse.statistics.newtonPasses).toBeGreaterThan(0);
  const denied = engineSetting(r, fuel, r.literal(0), r.literal(2), r.literal(2), throttle);
  const deniedInverse = r.contract({ fuel: [{ lo: 0.1, hi: 1 }], throttle: [{ lo: 0.1, hi: 1 }] }, [
    { term: denied.accepted, range: point(1) },
  ]);
  expect(deniedInverse.empty).toBe(true);
});

it('단 분리 reset은 기체 양쪽 운동량·위치·잔여 연료를 실제 분리와 동일하게 잇는다', () => {
  const stage = emptyStage();
  stage.rocket = defaultRocket();
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  run.velocity = { x: 0.3, y: -0.2 };
  run.rocket!.direction = { x: 0.6, y: 0.8 };
  const total = rocketMass(stage, run),
    detached = stage.rocket.parts[0].dryMass + run.rocket!.fuel[0];
  const r = new NonlinearRelation(),
    v = { x: r.input('vx'), y: r.input('vy') },
    p = { x: r.literal(run.position.x), y: r.literal(run.position.y) };
  const result = separationReset(
    r,
    p,
    v,
    { x: r.literal(0.6), y: r.literal(0.8) },
    r.literal(total),
    r.literal(detached),
    r.literal(0.12),
  );
  const values = r.evaluator([
    result.position.x,
    result.position.y,
    result.velocity.x,
    result.velocity.y,
    result.detachedVelocity.x,
    result.detachedVelocity.y,
  ])({ vx: 0.3, vy: -0.2 });
  expect(separate(run, stage)).toBe(true);
  expect(values).toEqual([
    run.position.x,
    run.position.y,
    run.velocity.x,
    run.velocity.y,
    run.detached[0].velocity.x,
    run.detached[0].velocity.y,
  ]);
  for (const fuel of [0, 0.3])
    for (const old of [0, 0.2])
      for (const ignitions of [0, 1, 2])
        for (const requested of [-1, 0, 0.2, 2]) {
          const actor = run.detached[0];
          actor.fuel = fuel;
          actor.throttle = old;
          actor.ignitions = ignitions;
          const part = stage.rocket.parts[0];
          part.ignitionLimit = 2;
          const expected = engineSetting(hybridFloat, fuel, old, ignitions, 2, requested);
          expect(controlEngine(run, stage, actor.id, requested)).toBe(Boolean(expected.accepted));
          expect([actor.throttle, actor.ignitions]).toEqual([
            expected.throttle,
            expected.ignitions,
          ]);
        }
});

it('여러 단·위성·부스터의 자원 모드는 경로 목록 대신 공유 조건부 상태로 이어진다', () => {
  const stage = emptyStage();
  stage.rocket = defaultRocket();
  stage.rocket.payloads = [{ id: 'sat', name: '위성', mass: 0.2, area: 0, releaseSpeed: 0.03 }];
  const initial = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  const r = new NonlinearRelation(),
    resources = new RocketResources(r, stage.rocket, initial);
  const accepted = [];
  accepted.push(resources.setting('craft', r.input('throttle')));
  resources.power(r.literal(0.01));
  accepted.push(resources.separate(r.literal(0.01)));
  accepted.push(resources.setting(stage.rocket.parts[0].id, r.literal(0.25)));
  accepted.push(resources.setting('craft', r.literal(0.5)));
  resources.power(r.literal(0.01));
  accepted.push(resources.release('sat', r.literal(0.02)));
  accepted.push(resources.release('sat', r.literal(0.03))); // rejected duplicate, not a second satellite
  const snapshot = resources.snapshot();
  const roots = [
    ...accepted,
    snapshot.partIndex,
    snapshot.fuel[0],
    snapshot.fuel[1],
    snapshot.velocity.x,
    snapshot.position.x,
    resources.mass(),
    snapshot.actors.get('sat')!.velocity.x,
    snapshot.actors.get(stage.rocket.parts[0].id)!.fuel,
  ];
  const evaluate = r.evaluator(roots);
  for (const throttle of [0, 0.2, 1]) {
    const run = structuredClone(initial),
      flags = [];
    flags.push(controlEngine(run, stage, 'craft', throttle));
    poweredStep(run, stage, 0.01);
    run.time = 0.01;
    flags.push(separate(run, stage));
    flags.push(controlEngine(run, stage, stage.rocket.parts[0].id, 0.25));
    flags.push(controlEngine(run, stage, 'craft', 0.5));
    poweredStep(run, stage, 0.01);
    poweredStep(run, stage, 0.01, run.detached[0]);
    run.time = 0.02;
    flags.push(releasePayload(run, stage, 'sat'));
    flags.push(releasePayload(run, stage, 'sat'));
    expect(evaluate({ throttle })).toEqual([
      ...flags.map(Number),
      run.rocket!.partIndex,
      run.rocket!.fuel[0],
      run.rocket!.fuel[1],
      run.velocity.x,
      run.position.x,
      rocketMass(stage, run),
      run.detached.find((v) => v.id === 'sat')!.velocity.x,
      run.detached[0].fuel,
    ]);
  }
});

it('종료된 비행에서는 자원 상태를 유지하고 후속 점화·분리를 허용하지 않는다', () => {
  const stage = emptyStage();
  stage.rocket = defaultRocket();
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  run.status = 'failed';
  const resources = new RocketResources(hybridFloat, stage.rocket, run),
    before = resources.snapshot();
  expect(resources.setting('craft', 1)).toBe(0);
  expect(resources.separate(1)).toBe(0);
  resources.power(0.01);
  expect(resources.snapshot()).toEqual(before);
});

it('이동 천체에 대한 캡슐 충돌의 끝면·옆면·관통·접선·무접촉을 한 수식으로 판정한다', () => {
  const r = new NonlinearRelation(),
    number = (n: number) => r.literal(n),
    hull = hullSize(3);
  const sweep = capsuleSweep(r, {
    before: { x: r.input('x'), y: r.input('y') },
    after: { x: r.input('a'), y: r.input('b') },
    heading: { x: number(1), y: number(0) },
    centerBefore: { x: number(0), y: number(0) },
    centerAfter: { x: number(0.1), y: number(0) },
    length: number(hull.length),
    hullRadius: number(hull.radius),
    radius: number(1),
  });
  const evaluate = r.evaluator([sweep.hit, sweep.time]);
  for (let i = 0; i < 81; i++)
    for (let j = 0; j < 21; j++) {
      const before = { x: -2 + i / 20, y: -1.5 + j / 7 },
        after = { x: before.x + 0.7, y: before.y - 0.1 };
      const expected = sweepHull(
        before,
        after,
        { x: 1, y: 0 },
        hull,
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        1,
      );
      const [hit, time] = evaluate({ x: before.x, y: before.y, a: after.x, b: after.y });
      expect(Boolean(hit)).toBe(expected !== undefined);
      if (expected !== undefined) expect(time).toBe(expected);
    }
});

it('목표 순서·유지·한번 달성 기억은 비활성 단계를 진행시키지 않고 실제 판정 이력과 일치한다', () => {
  const node: Condition = {
    kind: 'sequence',
    children: [
      {
        kind: 'hold',
        duration: 0.2,
        child: {
          kind: 'compare',
          left: { kind: 'metric', metric: 'time', targetId: '' },
          operator: 'gte',
          right: { kind: 'constant', value: 0.2 },
        },
      },
      { kind: 'once', child: { kind: 'event', event: 'separation', targetId: 'lower' } },
      { kind: 'not', child: { kind: 'event', event: 'collision', targetId: 'earth' } },
    ],
  };
  const stage = emptyStage(),
    goal = { ...newGoal(), condition: node };
  stage.goals = [goal];
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  run.rocket = {
    ...createRun({ ...stage, rocket: defaultRocket() }, { launch: { x: 0, y: 0 }, impulses: [] })
      .rocket!,
  };
  const p = freshProgress(),
    r = new NonlinearRelation(),
    history = new GoalHistory(r, [goal]);
  const roots = [];
  for (let i = 1; i <= 7; i++) {
    run.time = i / 10;
    run.rocket.separatedAt.lower = i === 4 ? (i - 1) / 10 : -1;
    const actual = evaluateCondition(
      node,
      { stage, run, dt: 0.1, previousTime: (i - 1) / 10, before: run.position },
      p,
    );
    const complete = history.advance(r.literal(run.time), r.literal(0.1), {
      metric: () => ({ value: r.literal(run.time), known: r.literal(1) }),
      event: (e) => ({
        value: r.literal(Number(e.event === 'separation' && i === 4)),
        known: r.literal(1),
      }),
    });
    roots.push({ term: complete[goal.id], actual });
  }
  const values = r.evaluator(roots.map((x) => x.term))({});
  expect(values.map(Boolean)).toEqual(roots.map((x) => x.actual));
});

it('충돌·착륙·목표·장애물·검사·종료의 모든 논리 조합에서 실제 종료 우선순위를 보존한다', () => {
  const r = new NonlinearRelation(),
    inputs = Object.fromEntries(
      ['goals', 'collision', 'landed', 'hazard', 'expired', 'probe'].map((s) => [s, r.input(s)]),
    );
  const graph = flightOutcome(r, {
    goals: inputs.goals,
    collision: inputs.collision,
    landed: inputs.landed,
    hazard: inputs.hazard,
    expired: inputs.expired,
    probe: inputs.probe,
  });
  const evaluate = r.evaluator([graph.won, graph.impact, graph.failed, graph.observed]);
  for (let mask = 0; mask < 64; mask++) {
    const values = Object.fromEntries(
      Object.keys(inputs).map((s, i) => [s, Number(!!(mask & (1 << i)))]),
    );
    const { goals, collision, landed, hazard, expired, probe } = values;
    const status =
      goals && !hazard && (!collision || landed) && !probe
        ? 'won'
        : collision && !landed
          ? 'impact'
          : hazard
            ? 'failed'
            : expired
              ? probe
                ? 'observed'
                : 'failed'
              : 'running';
    expect(evaluate(values).map(Boolean)).toEqual(
      ['won', 'impact', 'failed', 'observed'].map((s) => s === status),
    );
  }
  const result = r.contract(
    Object.fromEntries(
      Object.keys(inputs).map((s) => [
        s,
        [
          { lo: 0, hi: 0 },
          { lo: 1, hi: 1 },
        ],
      ]),
    ),
    [{ term: graph.won, range: point(1) }],
  );
  expect(result.empty).toBe(false);
  expect(result.domains.goals).toEqual(point(1));
  expect(result.domains.probe).toEqual(point(0));
  expect(result.domains.hazard).toEqual(point(0));
});

it('연료·연소·적분·캡슐 충돌·유지 이력·안전 종료를 연결한 성공 역상은 실제 비행의 성공을 보존한다', () => {
  const stage = emptyStage(),
    body = { ...newBody(), id: 'earth', radius: 1, mu: 0 };
  stage.bodies = [body];
  stage.rocket = defaultRocket();
  stage.rocket.parts[0].fuelMass = 0.03;
  stage.rocket.parts[0].thrust = 2;
  stage.rocket.parts[0].exhaustSpeed = 1;
  stage.spawn.position = { x: 1.0001, y: 0 };
  const goal = {
    ...newGoal(),
    condition: {
      kind: 'hold',
      duration: 0.004,
      child: {
        kind: 'all',
        children: [
          { kind: 'event', event: 'collision', targetId: body.id },
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'fuel', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 0.026 },
          },
        ],
      },
    } as Condition,
  };
  stage.goals = [goal];
  const r = new NonlinearRelation(),
    c = (n: number) => r.literal(n),
    throttle = r.input('throttle'),
    vx = r.input('vx'),
    dt = r.input('dt');
  const initial = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] }),
    resources = new RocketResources(r, stage.rocket, initial);
  resources.setting('craft', throttle);
  resources.power(dt);
  const state = resources.snapshot(),
    direction = { x: c(1), y: c(0) };
  const [position, velocity] = rk4(
    r,
    (p) => attraction(r, p, { x: c(0), y: c(0) }, c(0), c(0.2)),
    state.position,
    { x: r.add(vx, state.velocity.x), y: state.velocity.y },
    c(0),
    dt,
  );
  const hull = hullSize(3),
    contact = capsuleSweep(r, {
      before: state.position,
      after: position,
      heading: direction,
      centerBefore: { x: c(0), y: c(0) },
      centerAfter: { x: c(0), y: c(0) },
      length: c(hull.length),
      hullRadius: c(hull.radius),
      radius: c(1),
    });
  const goals = new GoalHistory(r, [goal]).advance(dt, dt, {
    metric: () => ({ known: c(1), value: state.fuel[0] }),
    event: () => ({ known: c(1), value: contact.hit }),
  });
  const landed = r.select(
    contact.hit,
    // Local x is surface-normal in this fixture. Match the shared standard
    // landing ellipse rather than the retired scalar total-speed threshold.
    r.lte(
      r.hypot(
        r.divide(velocity.x, c((stage.rocket.parts[0].maxLandingSpeed ?? 0.18) * 1.5)),
        r.divide(velocity.y, c((stage.rocket.parts[0].maxLandingSpeed ?? 0.18) * 3)),
      ),
      c(1),
    ),
    c(0),
  );
  const outcome = flightOutcome(r, {
    goals: goals[goal.id],
    collision: contact.hit,
    landed,
    hazard: c(0),
    expired: c(0),
    probe: c(0),
  });
  const inverse = r.contract(
    { throttle: [{ lo: 0, hi: 1 }], vx: [{ lo: -0.3, hi: 0 }], dt: [{ lo: 0.005, hi: 0.01 }] },
    [{ term: outcome.won, range: point(1) }],
  );
  expect(inverse.empty).toBe(false);
  expect(inverse.domains.throttle.at(-1)!.hi).toBeLessThan(0.401);
  const evaluate = r.evaluator([outcome.won]);
  let successes = 0,
    failures = 0;
  for (let vi = 0; vi <= 15; vi++)
    for (let ti = 0; ti <= 8; ti++)
      for (const duration of [0.005, 0.01]) {
        const assignment = { vx: -vi / 50, throttle: ti / 8, dt: duration };
        const actualStage = {
          ...stage,
          spawn: { ...stage.spawn, velocity: { x: assignment.vx, y: 0 } },
        };
        const run = createRun(actualStage, {
          launch: { x: stage.rules.launchLimit * assignment.throttle, y: 0 },
          impulses: [],
        });
        tick(run, actualStage, duration, [], false);
        expect(Boolean(evaluate(assignment)[0])).toBe(run.status === 'won');
        if (run.status === 'won') {
          successes++;
          for (const [key, value] of Object.entries(assignment))
            expect(inverse.domains[key].some((d) => d.lo <= value && value <= d.hi)).toBe(true);
        } else failures++;
      }
  expect(successes).toBeGreaterThan(0);
  expect(failures).toBeGreaterThan(0);
});

it('기록·참조·의존·양화·미정 상태의 목표 이력을 실제 순서별 판정과 대조한다', () => {
  const stage = emptyStage(),
    constant = (value: number) => ({ kind: 'constant', value }) as const;
  const capture = {
    ...newGoal(),
    id: 'capture',
    condition: {
      kind: 'sequence',
      children: [
        {
          kind: 'capture',
          key: 'saved',
          value: { kind: 'metric', metric: 'time', targetId: '' },
          when: {
            kind: 'compare',
            left: { kind: 'metric', metric: 'time', targetId: '' },
            operator: 'gte',
            right: constant(0.2),
          },
        },
        {
          kind: 'compare',
          left: { kind: 'recorded', key: 'saved' },
          operator: 'eq',
          right: constant(0.2),
        },
      ],
    } as Condition,
  };
  const reference = {
    ...newGoal(),
    id: 'reference',
    dependsOn: ['capture'],
    startTime: 0.3,
    condition: { kind: 'reference', goalId: 'capture' } as Condition,
  };
  const unknown = {
    ...newGoal(),
    id: 'unknown',
    condition: {
      kind: 'not',
      child: {
        kind: 'quantify',
        actorIds: ['absent'],
        mode: 'all',
        child: {
          kind: 'compare',
          left: { kind: 'metric', metric: 'speed', actorId: '$actor', targetId: '' },
          operator: 'lt',
          right: constant(1),
        },
      },
    } as Condition,
  };
  const source = {
    ...newGoal(),
    id: 'source',
    condition: {
      kind: 'compare',
      left: { kind: 'metric', metric: 'time', targetId: '' },
      operator: 'gte',
      right: constant(0.4),
    } as Condition,
  };
  const referenceWithoutCapture = {
    ...newGoal(),
    id: 'plain-reference',
    dependsOn: ['capture'],
    condition: { kind: 'reference', goalId: 'source' } as Condition,
  };
  stage.goals = [capture, reference, unknown, source, referenceWithoutCapture];
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] }),
    history = new GoalHistory(hybridFloat, stage.goals);
  for (let step = 1; step <= 10; step++) {
    run.time = step / 10;
    const c = { stage, run, before: run.position, previousTime: (step - 1) / 10, dt: 0.1 };
    updateGoals(c);
    const result = history.advance(run.time, 0.1, {
      metric: (e, scope) => {
        const value = expressionValue(
          e,
          {
            ...c,
            bindings: scope.binding
              ? { scope: scope.binding, actorId: scope.actorId, targetId: scope.targetId }
              : undefined,
          },
          freshProgress(),
        );
        return { value: Number.isFinite(value) ? value : 0, known: Number(Number.isFinite(value)) };
      },
      event: () => {
        throw Error('No event expected');
      },
    });
    expect(result).toEqual(
      Object.fromEntries(Object.entries(run.goals).map(([id, v]) => [id, Number(v.complete)])),
    );
  }
  expect(run.goals.capture.complete).toBe(true);
  // Reference-local captures are NOT copied from the referenced goal's memory.
  expect(run.goals.reference.complete).toBe(false);
  expect(run.goals['plain-reference'].complete).toBe(true);
  expect(run.goals.unknown.complete).toBe(false);
  const cyclic = {
    ...newGoal(),
    id: 'cycle',
    condition: { kind: 'reference', goalId: 'cycle' } as Condition,
  };
  expect(
    new GoalHistory(hybridFloat, [cyclic]).advance(1, 0.1, {
      metric: () => {
        throw Error();
      },
      event: () => {
        throw Error();
      },
    }),
  ).toEqual({ cycle: 0 });
});
