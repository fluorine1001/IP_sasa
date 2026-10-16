import { it, expect } from 'vitest';
import { blankStage, newGoal } from '../src/stages/factory';
import { defaultRocket, controlEngine } from '../src/world/rocket';
import { createRun, tick } from '../src/world/engine';
it('coasting rotation records translation, not the nozzle sweeping around the pivot', () => {
  const stage = blankStage();
  stage.bodies = [];
  stage.launchBodyId = undefined;
  stage.spawn = { position: { x: 0, y: 0 }, velocity: { x: 0.1, y: 0 } };
  stage.rocket = defaultRocket();
  stage.rules.launchLimit = 1;
  stage.goals = [
    {
      ...newGoal(),
      condition: {
        kind: 'compare',
        left: { kind: 'constant', value: 0 },
        operator: 'gt',
        right: { kind: 'constant', value: 1 },
      },
    },
  ];
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  run.rocket!.airborne = true;
  controlEngine(run, stage, 'craft', 0, { x: 0, y: 1 });
  tick(run, stage, 0.5);
  expect(run.trail.length).toBeGreaterThan(2);
  expect(Math.max(...run.trail.map((p) => Math.abs(p.position.y)))).toBeLessThan(1e-8);
  expect(run.velocity).toEqual({ x: 0.1, y: 0 });
});
