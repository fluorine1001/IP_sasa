import { describe, expect, it } from 'vitest';
import { blankStage, newBody, newGoal } from '../src/stages/factory';
import { defaultRocket } from '../src/world/rocket';
import { createRun, tick } from '../src/world/engine';
import { resolveHeading } from '../src/world/heading';
import { length, sub } from '../src/physics/vector';
import type { RoutePlan, Stage } from '../src/world/types';

function deepSpace(velocity = { x: 1, y: 0 }) {
  const stage = blankStage();
  stage.bodies = [];
  stage.launchBodyId = undefined;
  stage.spawn = { position: { x: 0, y: 0 }, velocity };
  stage.rocket = defaultRocket();
  stage.rules.launchLimit = 1;
  stage.rules.maxTime = 30;
  stage.goals = [
    {
      ...newGoal(),
      endTime: 30,
      condition: {
        kind: 'compare',
        left: { kind: 'constant', value: 0 },
        operator: 'gt',
        right: { kind: 'constant', value: 1 },
      },
    },
  ];
  return stage;
}
function fly(
  stage: Stage,
  plan: RoutePlan,
  seconds: number,
  setup?: (r: ReturnType<typeof createRun>) => void,
) {
  const run = createRun(stage, plan);
  run.rocket!.airborne = true;
  setup?.(run);
  for (let t = 0; t < seconds - 1e-9; t += 0.1) tick(run, stage, 0.1);
  return run;
}
const burnPlan = (
  dv: number,
  frame: 'prograde' | 'retrograde' | 'outward' | 'inward',
  angle = 0,
): RoutePlan => ({
  launch: { x: 0, y: 0 },
  impulses: [],
  engineCommands: [
    { id: 'b', time: 0.5, actorId: 'craft', burn: { dv, heading: { frame, angle } } },
  ],
});

describe('Δv 연소 예약', () => {
  it('정한 속력 변화를 정확히 내고 스스로 엔진을 끈다', () => {
    const stage = deepSpace();
    const run = fly(
      stage,
      burnPlan(0.2, 'prograde'),
      3,
      (r) => (r.rocket!.direction = { x: 1, y: 0 }),
    );
    expect(run.status).toBe('running');
    expect(length(run.velocity)).toBeCloseTo(1.2, 9);
    expect(run.rocket!.throttle).toBe(0);
    expect(run.rocket!.burn).toBeUndefined();
    expect(run.rocket!.ignitions[0]).toBe(1);
  });

  it('방향을 먼저 돌린 뒤 점화하므로 돌리는 동안의 추력이 섞이지 않는다', () => {
    const stage = deepSpace();
    // Pointing straight down: the hull must turn 90° before it may fire prograde.
    const run = fly(
      stage,
      burnPlan(0.15, 'prograde'),
      5,
      (r) => (r.rocket!.direction = { x: 0, y: -1 }),
    );
    expect(run.velocity.x).toBeCloseTo(1.15, 9);
    expect(Math.abs(run.velocity.y)).toBeLessThan(0.15 * Math.sin((0.5 * Math.PI) / 180) + 1e-9);
  });

  it('같은 계획은 같은 결과를 낸다', () => {
    const stage = deepSpace();
    const a = fly(stage, burnPlan(0.1, 'outward', 15), 4),
      b = fly(stage, burnPlan(0.1, 'outward', 15), 4);
    expect(a.position).toEqual(b.position);
    expect(a.velocity).toEqual(b.velocity);
  });

  it('연료가 모자라면 남은 만큼만 내고 끝난다', () => {
    const stage = deepSpace();
    const run = fly(
      stage,
      burnPlan(50, 'prograde'),
      20,
      (r) => (r.rocket!.direction = { x: 1, y: 0 }),
    );
    expect(run.rocket!.fuel[0]).toBeLessThan(1e-9);
    expect(run.rocket!.throttle).toBe(0);
    expect(length(run.velocity)).toBeLessThan(51);
  });

  it('수동 출력 명령은 기다리는 연소 예약을 취소한다', () => {
    const stage = deepSpace();
    const plan = burnPlan(0.2, 'retrograde');
    plan.engineCommands!.push({ id: 's', time: 0.6, actorId: 'craft', throttle: 0 });
    const run = fly(stage, plan, 5, (r) => (r.rocket!.direction = { x: 1, y: 0 }));
    expect(run.rocket!.burn).toBeUndefined();
    expect(length(run.velocity)).toBeCloseTo(1, 9);
  });
});

describe('궤도 기준 방향', () => {
  it('진행·반대·바깥·안쪽은 가장 강하게 당기는 천체에 대한 운동으로 정한다', () => {
    const stage = deepSpace();
    const body = newBody();
    body.mu = 1;
    body.radius = 0.5;
    stage.bodies = [body];
    // Above the body at (0, 2), moving left: prograde = -x, outward = +y.
    const at = { x: 0, y: 2 },
      v = { x: -0.7, y: 0 };
    const pro = resolveHeading(stage, at, v, 0, { frame: 'prograde', angle: 0 });
    const out = resolveHeading(stage, at, v, 0, { frame: 'outward', angle: 0 });
    const tilted = resolveHeading(stage, at, v, 0, { frame: 'prograde', angle: 90 });
    expect(pro.x).toBeCloseTo(-1);
    expect(out.y).toBeCloseTo(1);
    expect(length(sub(tilted, out))).toBeLessThan(1e-12);
    expect(resolveHeading(stage, at, v, 0, { frame: 'inward', angle: 0 }).y).toBeCloseTo(-1);
  });

  it('냉가스 추진도 궤도 기준 방향과 세기로 예약할 수 있다', () => {
    const stage = deepSpace({ x: 0, y: 1 });
    stage.rocket = undefined;
    stage.rules.maneuverBudget = 1;
    const run = createRun(stage, {
      launch: { x: 0, y: 0 },
      impulses: [
        {
          id: 'p',
          time: 0.5,
          vector: { x: 0.3, y: 0 },
          heading: { frame: 'prograde', angle: 0 },
          magnitude: 0.3,
        },
      ],
    });
    for (let t = 0; t < 1; t += 0.1) tick(run, stage, 0.1);
    expect(run.velocity.y).toBeCloseTo(1.3, 9);
    expect(run.velocity.x).toBeCloseTo(0, 9);
    expect(run.used).toBeCloseTo(0.3, 12);
  });
});

describe('근점·원점 연소', () => {
  function orbiting(at: 'apoapsis' | 'periapsis') {
    const stage = deepSpace();
    const body = newBody();
    body.radius = 0.2;
    stage.bodies = [body];
    // Faster than circular, slower than escape: an ellipse starting at periapsis.
    stage.spawn = { position: { x: 1, y: 0 }, velocity: { x: 0, y: 1.15 } };
    stage.rules.maxTime = 60;
    stage.goals[0].endTime = 60;
    const run = createRun(stage, {
      launch: { x: 0, y: 0 },
      impulses: [],
      engineCommands: [
        {
          id: 'c',
          time: 0.1,
          actorId: 'craft',
          burn: { dv: 0.05, heading: { frame: 'prograde', angle: 0 }, at },
        },
      ],
    });
    run.rocket!.airborne = true;
    run.rocket!.direction = { x: 0, y: 1 };
    let lit = NaN,
      highest = 0,
      highestAt = 0,
      lowest = Infinity,
      lowestAt = 0;
    for (let t = 0; t < 40 && Number.isNaN(lit); t += 0.05) {
      tick(run, stage, 0.05);
      const r = length(run.position);
      if (r > highest) ((highest = r), (highestAt = run.time));
      if (r < lowest && run.time > highestAt) ((lowest = r), (lowestAt = run.time));
      if (run.rocket!.throttle > 0) lit = run.time;
    }
    return { run, lit, highestAt, lowestAt };
  }

  it('정한 시각 이후 첫 원점에서 점화한다', () => {
    const { lit, highestAt } = orbiting('apoapsis');
    expect(Number.isFinite(lit)).toBe(true);
    // It turns only once the orbit turns, so it lights shortly after the highest point.
    expect(lit).toBeGreaterThanOrEqual(highestAt - 0.05);
    expect(lit - highestAt).toBeLessThan(1.5);
  });

  it('원점을 지난 뒤 첫 근점에서 점화한다', () => {
    const { lit, highestAt } = orbiting('periapsis');
    expect(Number.isFinite(lit)).toBe(true);
    expect(lit).toBeGreaterThan(highestAt);
  });

  it('같은 근점·원점 계획은 같은 결과를 낸다', () => {
    const a = orbiting('apoapsis').run,
      b = orbiting('apoapsis').run;
    expect(a.position).toEqual(b.position);
  });
});

describe('높이 연소와 대기 추진', () => {
  function falling() {
    const stage = deepSpace();
    const body = newBody();
    body.radius = 0.5;
    body.mu = 0.1;
    stage.bodies = [body];
    stage.spawn = { position: { x: 0, y: 2 }, velocity: { x: 0, y: 0 } };
    return stage;
  }
  it('정한 높이까지 내려오면 점화한다', () => {
    const stage = falling();
    const run = createRun(stage, {
      launch: { x: 0, y: 0 },
      impulses: [],
      engineCommands: [
        {
          id: 'b',
          time: 0,
          actorId: 'craft',
          burn: {
            dv: 0.05,
            heading: { frame: 'outward', angle: 0 },
            at: 'altitude',
            altitude: 0.8,
          },
        },
      ],
    });
    run.rocket!.airborne = true;
    let litHeight = NaN;
    for (let t = 0; t < 20 && Number.isNaN(litHeight); t += 0.01) {
      tick(run, stage, 0.01);
      if (run.rocket!.throttle > 0) litHeight = length(run.position) - 0.5;
    }
    expect(litHeight).toBeLessThanOrEqual(0.8);
    expect(litHeight).toBeGreaterThan(0.75);
  });

  it('냉가스 추진도 근점·원점·높이를 기다렸다가 낸다', () => {
    const stage = falling();
    stage.rocket = undefined;
    stage.rules.maneuverBudget = 1;
    const run = createRun(stage, {
      launch: { x: 0, y: 0 },
      impulses: [
        {
          id: 'p',
          time: 0,
          vector: { x: 0, y: 0.2 },
          heading: { frame: 'outward', angle: 0 },
          magnitude: 0.2,
          at: 'altitude',
          altitude: 1,
        },
      ],
    });
    let fired = NaN;
    for (let t = 0; t < 20 && Number.isNaN(fired); t += 0.01) {
      tick(run, stage, 0.01);
      if (run.used > 0) fired = length(run.position) - 0.5;
    }
    expect(fired).toBeLessThanOrEqual(1);
    expect(fired).toBeGreaterThan(0.95);
    expect(run.used).toBeCloseTo(0.2, 12);
  });
});
