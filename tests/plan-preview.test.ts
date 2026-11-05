import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { keplerApsis, previewStates } from '../src/world/plan-preview';
import { length } from '../src/physics/vector';
import type { RoutePlan } from '../src/world/types';

function circle() {
  const s = blankStage();
  s.bodies[0].mu = 1;
  s.bodies[0].position = { x: 0, y: 0 };
  s.bodies[0].radius = 0.2;
  return s;
}

it('케플러 근점·원점은 에너지와 각운동량으로 구한다', () => {
  const s = circle();
  // From periapsis r = 1 at v = 1.2: apoapsis r_a = r_p v² / (2μ/r_p − v²).
  const apo = keplerApsis(
    s,
    { position: { x: 1, y: 0 }, velocity: { x: 0, y: 1.2 }, time: 0 },
    'apoapsis',
  )!;
  const expected = 1.44 / (2 - 1.44);
  expect(length(apo.position)).toBeCloseTo(expected, 9);
  expect(length(apo.velocity)).toBeCloseTo(1.2 / expected, 9);
  expect(apo.position.x).toBeLessThan(0); // the far side
});

it('예약한 호만 전이 두 번을 계산기가 순서대로 보여 준다', () => {
  const s = circle();
  const v1 = Math.sqrt(4 / 3) - 1,
    v2 = Math.sqrt(1 / 2) - Math.sqrt(1 / 2) * Math.sqrt(2 / 3);
  const plan: RoutePlan = {
    launch: { x: 0, y: 0 },
    impulses: [
      {
        id: 'a',
        time: 1,
        vector: { x: 0, y: v1 },
        heading: { frame: 'prograde', angle: 0 },
        magnitude: v1,
      },
      {
        id: 'b',
        time: 2,
        vector: { x: 0, y: v2 },
        heading: { frame: 'prograde', angle: 0 },
        magnitude: v2,
        at: 'apoapsis',
      },
    ],
  };
  const recorded = (t: number) =>
    t <= 1 ? { position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 }, time: t } : undefined;
  const states = previewStates(s, plan, recorded);
  expect(states).toHaveLength(2);
  // After the second push: the circle of radius 2.
  const last = states[1].state;
  expect(length(last.position)).toBeCloseTo(2, 9);
  expect(length(last.velocity)).toBeCloseTo(Math.sqrt(1 / 2), 9);
});

it('지난 비행과 달라진 뒤의 시각 예약은 계산하지 않는다', () => {
  const s = circle();
  const plan: RoutePlan = {
    launch: { x: 0, y: 0 },
    impulses: [{ id: 'a', time: 5, vector: { x: 0, y: 0.1 } }],
  };
  expect(previewStates(s, plan, () => undefined)).toEqual([]);
});
