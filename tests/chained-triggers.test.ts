/* Reservations anchored to events instead of the clock: "after the previous one" and
 * "at an angle on the orbit". The point is that changing an earlier reservation does
 * not move where a later one acts, so effects stay separable for the player. */
import { describe, expect, it } from 'vitest';
import { blankStage, newBody, newGoal } from '../src/stages/factory';
import { defaultRocket } from '../src/world/rocket';
import { createRun, tick } from '../src/world/engine';
import { length } from '../src/physics/vector';
import type { RoutePlan, Stage } from '../src/world/types';

function space(withBody = false): Stage {
  const stage = blankStage();
  stage.bodies = [];
  stage.launchBodyId = undefined;
  stage.spawn = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 1 } };
  stage.rocket = undefined;
  stage.rules.maneuverBudget = 2;
  stage.rules.launchLimit = 1;
  stage.rules.maxTime = 60;
  stage.goals = [
    {
      ...newGoal(),
      endTime: 60,
      condition: {
        kind: 'compare',
        left: { kind: 'constant', value: 0 },
        operator: 'gt',
        right: { kind: 'constant', value: 1 },
      },
    },
  ];
  if (withBody) {
    const body = newBody();
    body.radius = 0.2;
    stage.bodies = [body];
    stage.spawn = { position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 } };
  }
  return stage;
}
function fly(stage: Stage, plan: RoutePlan, seconds: number, dt = 0.05) {
  const run = createRun(stage, plan);
  const log: { time: number; vx: number; vy: number }[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    tick(run, stage, dt);
    log.push({ time: run.time, vx: run.velocity.x, vy: run.velocity.y });
  }
  return { run, log };
}

describe('앞 예약 뒤 예약', () => {
  const plan = (first: number): RoutePlan => ({
    launch: { x: 0, y: 0 },
    impulses: [
      { id: 'a', time: first, vector: { x: 0.3, y: 0 } },
      { id: 'b', time: 0, vector: { x: 0, y: 0.2 }, at: 'after', ref: 'a', delay: 0.5 },
    ],
  });
  it('앞 예약이 끝난 뒤 정한 간격에 실행된다', () => {
    const { run, log } = fly(space(), plan(1), 3);
    expect(run.firedAt?.a).toBeCloseTo(1, 6);
    expect(run.firedAt?.b).toBeCloseTo(1.5, 6);
    const before = log.find((f) => f.time >= 1.4 && f.time < 1.45)!;
    expect(before.vy).toBeCloseTo(1, 9);
    expect(run.velocity.y).toBeCloseTo(1.2, 9);
  });
  it('앞 예약을 옮기면 뒤 예약도 함께 옮겨진다', () => {
    const { run } = fly(space(), plan(2), 4);
    expect(run.firedAt?.b).toBeCloseTo(2.5, 6);
  });
  it('앞 예약이 실행되지 않으면 뒤 예약도 실행되지 않는다', () => {
    const p = plan(1);
    p.impulses[1].ref = 'missing';
    const { run } = fly(space(), p, 3);
    expect(run.firedAt?.b).toBeUndefined();
    expect(run.velocity.y).toBeCloseTo(1, 9);
  });
});

describe('위치각 예약', () => {
  it('궤도 위 정한 각도를 지날 때 실행되고, 앞 예약 시각과 무관하게 같은 자리에서 실행된다', () => {
    const at = (arm: number) => {
      const stage = space(true);
      const { run } = fly(
        stage,
        {
          launch: { x: 0, y: 0 },
          impulses: [
            {
              id: 'p',
              time: arm,
              vector: { x: 0, y: 0 },
              heading: { frame: 'prograde', angle: 0 },
              magnitude: 0.1,
              at: 'angle',
              atAngle: 90,
            },
          ],
        },
        8,
      );
      return run;
    };
    const a = at(0.1),
      b = at(0.6);
    expect(a.firedAt?.p).toBeDefined();
    // Same place on the orbit, so the same state afterwards.
    expect(a.firedAt?.p).toBeCloseTo(b.firedAt!.p, 1);
    expect(length(a.velocity)).toBeCloseTo(length(b.velocity), 2);
  });
});
