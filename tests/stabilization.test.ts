import { expect, it } from 'vitest';
import { blankStage, emptyStage } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';
import { craftHull, hullGap, hullPoseAt, settleHull, sweepHull } from '../src/world/hull';
import { rocketMass } from '../src/world/rocket';

it('0.7 추력비 기체는 지면에 머무르며 연료를 소비한다', () => {
  const stage = blankStage();
  const body = stage.bodies[0];
  body.radius = 1;
  body.mu = 1;
  stage.rocket!.parts = stage.rocket!.parts.slice(0, 1);
  stage.rocket!.parts[0].fuelMass = 1;
  stage.rocket!.parts[0].exhaustSpeed = 1e9;
  stage.goals = [];
  stage.rules.maxTime = 11;
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  run.landed = { bodyId: body.id, angle: 0 };
  run.rocket!.airborne = true;
  run.rocket!.throttle = 1;
  run.position = settleHull(
    { x: 1.005, y: 0 },
    run.rocket!.direction,
    craftHull(stage, run),
    body.position,
    body.radius,
  );
  run.velocity = { x: 0, y: 0 };
  stage.rocket!.parts[0].thrust = 0.7 * rocketMass(stage, run);
  let transitions = 0,
    last = true;
  for (let i = 0; i < 1000 && run.status === 'running'; i++) {
    tick(run, stage, 0.01);
    const landed = !!run.landed;
    if (landed !== last) transitions++;
    last = landed;
  }
  expect(transitions).toBe(0);
  expect(run.rocket!.fuel[0]).toBeLessThan(stage.rocket!.parts[0].fuelMass);
});

it('추진 한도 초과 시 마지막 재생 프레임에 실패 상태가 남는다', () => {
  const stage = emptyStage();
  stage.spawn.placed = true;
  stage.rules.maneuverBudget = 0.1;
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  run.plan.impulses.push({ id: 'over', time: 0, vector: { x: 1, y: 0 } });
  tick(run, stage, 0.01);
  expect(run.status).toBe('failed');
  expect(run.frames!.at(-1)?.status).toBe('failed');
});

it('과열로 종료할 때 마지막 재생 프레임에 실패가 남는다', () => {
  const stage = blankStage(),
    run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  run.rocket!.heat = stage.rocket!.parts[0].maxHeat * 2;
  tick(run, stage, 0.01);
  expect(run.status).toBe('failed');
  expect(run.frames!.at(-1)?.status).toBe('failed');
});

it('회전 스윕은 촘촘한 관측에서 겹친 경우 충돌을 놓치지 않는다', () => {
  let seed = 12345;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const hull = { length: 2, radius: 0.05 };
  for (let i = 0; i < 250; i++) {
    const a = random() * 6.28,
      b = a + (random() - 0.5) * 3;
    const h0 = { x: Math.cos(a), y: Math.sin(a) },
      h1 = { x: Math.cos(b), y: Math.sin(b) };
    const p0 = { x: random() - 0.5, y: random() - 0.5 },
      p1 = { x: random() - 0.5, y: random() - 0.5 };
    const center = { x: random() * 3 - 1.5, y: random() * 3 - 1.5 },
      radius = 0.1;
    let overlap = false;
    for (let j = 0; j <= 1000; j++) {
      const pose = hullPoseAt(p0, p1, h0, h1, hull, j / 1000);
      if (hullGap(pose.position, pose.heading, hull, center, radius) < -1e-6) {
        overlap = true;
        break;
      }
    }
    if (overlap)
      expect(sweepHull(p0, p1, h1, hull, center, center, radius, h0), `case ${i}`).toBeDefined();
  }
});
