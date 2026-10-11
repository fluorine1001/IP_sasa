import { describe, it, expect } from 'vitest';
import { blankStage, newBody, newGoal } from '../src/stages/factory';
import {
  defaultRocket,
  separate,
  rocketMass,
  controlEngine,
  atmosphericState,
} from '../src/world/rocket';
import { createRun, tick } from '../src/world/engine';
import { binaryPair, dynamicView } from '../src/world/dynamics';
import { bodyPosition } from '../src/world/celestial';
import { length, sub } from '../src/physics/vector';
function bench() {
  const stage = blankStage();
  stage.bodies = [];
  stage.spawn = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
  stage.rocket = defaultRocket();
  stage.goals = [
    {
      ...newGoal(),
      condition: {
        kind: 'compare',
        left: { kind: 'constant', value: 0 },
        operator: 'gt',
        right: { kind: 'constant', value: 1 },
      },
      position: { x: 100, y: 100 },
    },
  ];
  stage.rules.launchLimit = 1;
  const run = createRun(stage, { launch: { x: 1, y: 0 }, impulses: [] });
  run.rocket!.airborne = true;
  return { stage, run };
}
describe('3단 추진과 대기권 병목', () => {
  it('연료를 소비하며 로켓 방정식에 맞는 속도 변화가 생긴다', () => {
    const { stage, run } = bench(),
      mass = rocketMass(stage, run),
      part = stage.rocket!.parts[0];
    tick(run, stage, 0.2, [], false);
    const spent = (part.thrust * 0.2) / part.exhaustSpeed;
    expect(run.rocket!.fuel[0]).toBeCloseTo(part.fuelMass - spent, 8);
    expect(run.velocity.x).toBeCloseTo(part.exhaustSpeed * Math.log(mass / (mass - spent)), 8);
  });
  it('단 분리는 두 물체에 기존 속도를 이어주고 전체 운동량을 보존한다', () => {
    const { stage, run } = bench();
    tick(run, stage, 0.2);
    const mass = rocketMass(stage, run),
      v = { ...run.velocity },
      p = { ...run.position };
    expect(separate(run, stage)).toBe(true);
    const actor = run.detached[0];
    const upperMass = rocketMass(stage, run),
      lowerMass = actor.dryMass + actor.fuel;
    expect(actor.velocity.x * lowerMass + run.velocity.x * upperMass).toBeCloseTo(v.x * mass, 10);
    expect(actor.velocity.y * lowerMass + run.velocity.y * upperMass).toBeCloseTo(v.y * mass, 10);
    expect(actor.position).toEqual(p);
    expect(rocketMass(stage, run) + actor.dryMass + actor.fuel).toBeCloseTo(mass, 10);
    expect(run.rocket!.throttle).toBe(0);
    expect(run.rocket!.partIndex).toBe(1);
  });
  it('주 로켓만 재점화하면 부스터는 관성으로 다른 경로를 간다', () => {
    const { stage, run } = bench();
    separate(run, stage);
    expect(controlEngine(run, stage, 'craft', 1, { x: 0, y: 1 })).toBe(true);
    tick(run, stage, 0.2);
    expect(run.position.y).toBeGreaterThan(run.detached[0].position.y);
    expect(run.detached[0].fuel).toBe(stage.rocket!.parts[0].fuelMass);
  });
  it('부스터의 남은 연료와 재점화 횟수가 독립적으로 제한된다', () => {
    const { stage, run } = bench(),
      part = stage.rocket!.parts[0];
    separate(run, stage);
    expect(controlEngine(run, stage, part.id, 1)).toBe(true);
    tick(run, stage, 0.1);
    expect(run.detached[0].fuel).toBeLessThan(part.fuelMass);
    controlEngine(run, stage, part.id, 0);
    expect(controlEngine(run, stage, part.id, 1)).toBe(false);
  });
  it('대기 밀도와 동압이 고도·상대속력에 따라 달라진다', () => {
    const stage = blankStage();
    stage.bodies[0].radius = 1;
    stage.bodies[0].atmosphere = { height: 0.6, density: 1.2, scaleHeight: 0.15 };
    const low = atmosphericState(stage, { x: 1.05, y: 0 }, { x: 0, y: 0.5 }, 0),
      high = atmosphericState(stage, { x: 1.5, y: 0 }, { x: 0, y: 0.5 }, 0);
    expect(low.density / high.density).toBeGreaterThan(15);
    expect(atmosphericState(stage, { x: 2, y: 0 }, { x: 0, y: 10 }, 0).q).toBe(0);
    expect(atmosphericState(stage, { x: 1.05, y: 0 }, { x: 0, y: 1 }, 0).q).toBeCloseTo(
      low.q * 4,
      8,
    );
  });
});
it('상호 중력 쌍성은 실제로 움직이며 질량 중심과 궤도 간격을 유지한다', () => {
  const stage = blankStage(),
    a = newBody('star'),
    b = newBody('star');
  a.radius = 0.1;
  b.radius = 0.1;
  a.mu = 1;
  b.mu = 0.7;
  binaryPair({ x: 0, y: 0 }, a, b, 2.5);
  stage.bodies = [a, b];
  stage.spawn = { position: { x: 10, y: 0 }, velocity: { x: 0, y: 0 } };
  stage.goals = [
    {
      ...newGoal(),
      condition: {
        kind: 'compare',
        left: { kind: 'constant', value: 0 },
        operator: 'gt',
        right: { kind: 'constant', value: 1 },
      },
      position: { x: 100, y: 100 },
    },
  ];
  stage.rules.maxTime = 40;
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  for (let i = 0; i < 400; i++) tick(run, stage, 0.05, [], false);
  const view = dynamicView(stage, run),
    p = bodyPosition(view, view.bodies[0], run.time),
    q = bodyPosition(view, view.bodies[1], run.time);
  expect(length(sub(p, q))).toBeCloseTo(2.5, 5);
  expect(p.x + (b.mu / a.mu) * q.x).toBeCloseTo(0, 8);
  expect(p.y + (b.mu / a.mu) * q.y).toBeCloseTo(0, 8);
  expect(p).not.toEqual(a.position);
});
