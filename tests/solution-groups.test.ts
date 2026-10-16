import { it, expect } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { mergeOverlappingFamilies } from '../src/editor/solution-groups';
import {
  searchSolutions,
  searchParameters,
  type SolutionFamily,
} from '../src/editor/solution-search';
import type { RoutePlan } from '../src/world/types';

it('성공 후 실행되지 않은 예약은 예산을 소비한 재판정 후 대표 계획에서 제거한다', () => {
  const stage = blankStage();
  stage.rules.maxTime = 0.2;
  stage.audit.timeLimit = 0.2;
  stage.rocket = undefined;
  stage.launchBodyId = undefined;
  stage.spawn.position = { x: 2, y: 0 };
  stage.bodies[0].mu = 0;
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.05 },
  };
  const plan = {
    launch: { x: 0.1, y: 0 },
    impulses: [{ id: 'never', time: 0.15, vector: { x: 0, y: 0 } }],
  };
  const parameters = searchParameters(stage, plan);
  parameters.forEach((p) => (p.enabled = false));
  const result = [
    ...searchSolutions(stage, { id: 'suffix', label: 'suffix', plan, parameters }, 8, false),
  ].at(-1)!;
  expect(result.evaluated).toBe(2);
  expect(result.families[0].representative.impulses).toEqual([]);
  expect(result.families[0].template).toBe('발사');
});
it('ID만 다른 동일 실현 해는 합치지만 범위만 겹치는 서로 다른 해는 합치지 않는다', () => {
  const stage = blankStage();
  const family = (id: number, plan: RoutePlan): SolutionFamily => ({
    id,
    template: '',
    representative: plan,
    samples: [plan],
    ranges: [{ label: '출력', min: 0, max: 1, gap: 1 }],
    count: 1,
    trail: [],
  });
  const a = {
    launch: { x: 0.1, y: 0 },
    impulses: [{ id: 'a', time: 0.1, vector: { x: 0, y: 0.1 } }],
  };
  const b = structuredClone(a);
  b.impulses[0].id = 'b';
  const c = structuredClone(a);
  c.impulses[0].vector.y = 0.10001;
  const result = mergeOverlappingFamilies(stage, [family(1, a), family(2, b), family(3, c)]);
  expect(result).toHaveLength(2);
  expect(result[0].layouts).toBe(2);
  expect(result[0].samples).toHaveLength(1);
});
