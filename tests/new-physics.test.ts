import { it, expect } from 'vitest';
import { eccentricity, circularState } from '../src/physics/orbit';
import { blankStage } from '../src/stages/factory';
import { compileOutcome } from '../src/stages/outcomes';
import { execute } from '../src/world/engine';
import { binaryPair, advanceBodies } from '../src/world/dynamics';
import { createRun } from '../src/world/engine';
import { gravity } from '../src/world/celestial';
import { wheelImpulse, coastScroll } from '../src/app/inertial-scroll';
it('원형에 가까운 궤도는 실제 한 바퀴를 요구하며 직선 통과는 성공하지 않는다', () => {
  const stage = blankStage();
  stage.rocket = undefined;
  stage.launchBodyId = undefined;
  stage.bodies[0].radius = 0.1;
  stage.bodies[0].mu = 1;
  stage.bodies[0].position = { x: 0, y: 0 };
  stage.spawn = { position: { x: 1, y: 0 }, velocity: { x: 0, y: 0 } };
  stage.rules.maxTime = 20;
  stage.rules.worldRadius = 20;
  stage.rules.launchLimit = 2;
  Object.assign(
    stage.goals[0],
    compileOutcome(stage, {
      kind: 'circular',
      targetId: stage.bodies[0].id,
      min: 0.8,
      max: 1.2,
      eccentricity: 0.2,
      duration: 2,
    }),
    { endTime: 20 },
  );
  const circular = execute(stage, { launch: { x: 0, y: 1 }, impulses: [] }, true);
  expect(circular.status).toBe('won');
  expect(circular.time).toBeGreaterThan(6);
  expect(execute(stage, { launch: { x: 1, y: 0.1 }, impulses: [] }).status).not.toBe('won');
  expect(eccentricity(circularState(1, 1), 1)).toBeCloseTo(0);
});
it('환경 유지 100%는 연속 유지이며 일부 비율은 완전한 시간 창을 요구한다', () => {
  const stage = blankStage(),
    targetId = stage.bodies[0].id;
  const continuous = compileOutcome(stage, {
    kind: 'environment',
    targetId,
    metric: 'radialSpeed',
    min: -1,
    max: 1,
    duration: 4,
    insideFraction: 1,
  });
  expect(continuous.condition.kind).toBe('hold');
  const partial = compileOutcome(stage, {
    kind: 'environment',
    targetId,
    metric: 'airDensity',
    min: 0,
    max: 2,
    duration: 4,
    insideFraction: 0.9,
  });
  expect(JSON.stringify(partial.condition)).toContain('coverage');
  expect(JSON.stringify(partial.condition)).toContain('fractionPositive');
});
it('쌍성계는 상호 중력으로 움직이고 로켓도 두 중력원의 영향을 받는다', () => {
  const stage = blankStage(),
    a = stage.bodies[0],
    b = structuredClone(a);
  b.id = 'second';
  b.mu = 0.7;
  a.mu = 1;
  a.radius = b.radius = 0.1;
  stage.bodies.push(b);
  binaryPair({ x: 0, y: 0 }, a, b, 3);
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  const before = structuredClone(run.bodies!);
  for (let i = 0; i < 1000; i++) {
    advanceBodies(stage, run, 0.01);
    run.time += 0.01;
  }
  const p = run.bodies![a.id].position,
    q = run.bodies![b.id].position;
  expect(p.y).not.toBeCloseTo(before[a.id].position.y);
  expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(3, 6);
  expect(p.x * a.mu + q.x * b.mu).toBeCloseTo(0, 7);
  expect(p.y * a.mu + q.y * b.mu).toBeCloseTo(0, 7);
  const whole = gravity(stage, { x: 0, y: 4 }, 0),
    one = gravity({ ...stage, bodies: [a] }, { x: 0, y: 4 }, 0);
  expect(whole.y).toBeLessThan(one.y);
});
it('휠 단발은 제한된 거리, 연속 입력은 누적, 반대 방향은 즉시 전환한다', () => {
  const once = wheelImpulse(0, 100),
    twice = wheelImpulse(once, 100);
  expect(coastScroll(once, 5).distance).toBeCloseTo(50);
  expect(coastScroll(twice, 5).distance).toBeGreaterThan(90);
  expect(wheelImpulse(twice, -100)).toBe(-500);
  expect(coastScroll(once, 1).velocity).toBeLessThan(1);
});
