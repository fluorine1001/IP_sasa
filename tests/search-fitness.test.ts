import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { createRun } from '../src/world/engine';
import { searchFitness } from '../src/editor/search-fitness';

it('즉시 판정 유지 조건의 오차는 NaN이 아니며 실제 목표 기억을 변경하지 않는다', () => {
  const stage = blankStage();
  stage.goals[0].condition = {
    kind: 'hold',
    duration: 0,
    child: {
      kind: 'compare',
      left: { kind: 'metric', metric: 'time', targetId: '' },
      operator: 'gte',
      right: { kind: 'constant', value: 1 },
    },
  };
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  const before = structuredClone(run.goals);
  const fitness = searchFitness(stage, run);
  expect(Number.isFinite(fitness)).toBe(true);
  expect(fitness).toBeGreaterThanOrEqual(0);
  expect(fitness).toBeLessThanOrEqual(1);
  expect(run.goals).toEqual(before);
});
