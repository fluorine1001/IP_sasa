import { expect, it } from 'vitest';
import { stalledSurfaceOrbit } from './fixtures/stalled-surface-orbit';
import { createRun, tick, execute } from '../src/world/engine';
import { rocketMass } from '../src/world/rocket';
import { surfaceLaunch } from '../src/world/launch';
import { gravity } from '../src/world/celestial';
import { dot, sub, length } from '../src/physics/vector';

it('실제 미저장 장면의 전출력은 발사대에서 뜨지 않는다; 탐색 실패를 전역 불가능으로 바꾸지는 않는다', () => {
  const s = stalledSurfaceOrbit(),
    plan = { launch: { x: s.rules.launchLimit, y: 0 }, impulses: [] };
  const start = createRun(s, plan),
    pad = surfaceLaunch(s)!;
  const thrust = s.rocket!.parts[0].thrust / rocketMass(s, start);
  const downward = -dot(gravity(s, pad.position, 0), pad.normal);
  expect(thrust).toBeCloseTo(0.15625, 8);
  expect(downward).toBeGreaterThan(2.7);
  const flight = execute(s, plan);
  expect(flight.status).not.toBe('won');
  expect(flight.rocket!.airborne).toBe(false);
  expect(length(sub(flight.position, pad.position))).toBeLessThan(1e-8);
  // Controlled counterfactual in a fresh test object, never a source-stage edit.
  const weakGravity = stalledSurfaceOrbit();
  weakGravity.bodies[0].mu = 0.01;
  const comparison = createRun(weakGravity, plan);
  tick(comparison, weakGravity, 0.5, weakGravity.objects, false);
  expect(comparison.rocket!.airborne).toBe(true);
});
