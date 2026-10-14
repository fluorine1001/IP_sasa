import { it, expect } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { compileOutcome } from '../src/stages/outcomes';
import { exhaustShape } from '../src/render/exhaust';
import { dialAngle, dialRotation } from '../src/screens/flight/engine-bench';
it('direction control and world map share the same axes at any launch pad', () => {
  expect(dialAngle(1, 0)).toBe(0);
  expect(dialRotation(0)).toBe(90);
  expect(dialAngle(0, -1, Math.PI / 2)).toBe(0);
  expect(dialRotation(0, Math.PI / 2)).toBe(0);
});
it('region outcome only tests the visible band and its meaningful dwell', () => {
  const stage = blankStage(),
    targetId = stage.bodies[0].id;
  const goal = compileOutcome(stage, {
    kind: 'region',
    targetId,
    min: 1,
    max: 3,
    duration: 1.2,
    coast: true,
  });
  const json = JSON.stringify(goal.condition);
  expect(json).not.toMatch(/fuel|speed|separation/);
  expect(json).toContain('throttle');
  expect(goal.display?.max).toBe(stage.bodies[0].radius + 3);
});
it('orbit requires a full net revolution, not back-and-forth accumulation', () => {
  const stage = blankStage();
  const goal = compileOutcome(stage, {
    kind: 'orbit',
    targetId: stage.bodies[0].id,
    min: 1,
    max: 3,
    insideFraction: 0.9,
  });
  expect(JSON.stringify(goal.condition)).toContain('orbitTurns');
  expect(JSON.stringify(goal.condition)).not.toMatch(/rms|energy|angularTravel/);
});
it('exhaust is absent when off, legible at low power, and grows with output', () => {
  expect(exhaustShape(0, 150, 0).length).toBe(0);
  expect(exhaustShape(0.1, 150, 0).length).toBeGreaterThan(10);
  expect(exhaustShape(1, 150, 0).length).toBeGreaterThan(exhaustShape(0.5, 150, 0).length);
  expect(exhaustShape(1, 150, 0, true)).toEqual(exhaustShape(1, 150, 15, true));
});
