import { expect, it } from 'vitest';
import { landingReading } from '../src/world/landing';
import { emptyStage, newBody, newGoal } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';
it('완만한 옆미끄러짐과 자전 표면의 속도를 고려하지만 강한 정면 충돌은 거절한다', () => {
  const s = emptyStage(),
    b = { ...newBody(), radius: 0.6, mu: 0.0001, spin: 1 };
  s.bodies = [b];
  expect(
    landingReading(s, b, { x: 0.6, y: 0 }, { x: -0.1, y: 0.8 }, { x: 1, y: 0 }, 0, 0.18).safe,
  ).toBe(true);
  expect(
    landingReading(s, b, { x: 0.6, y: 0 }, { x: -2, y: 0.6 }, { x: 1, y: 0 }, 0, 0.18).safe,
  ).toBe(false);
  b.spin = 0;
  s.spawn = { placed: true, position: { x: 0.601, y: 0 }, velocity: { x: -0.1, y: 0.2 } };
  s.goals = [
    {
      ...newGoal(),
      condition: {
        kind: 'compare',
        operator: 'gte',
        left: { kind: 'metric', metric: 'landed', targetId: b.id },
        right: { kind: 'constant', value: 1 },
      },
    },
  ];
  const run = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  tick(run, s, 0.1);
  expect(run.status).toBe('won');
  expect(run.touchdownNormalSpeed).toBeGreaterThan(0);
  expect(run.touchdownTangentialSpeed).toBeGreaterThan(0.15);
  s.rules.landingMode = 'precision';
  const strict = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  tick(strict, s, 0.1);
  expect(strict.status).not.toBe('won');
});
