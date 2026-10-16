import { it, expect } from 'vitest';
import { orbitShooting, dampedStep } from '../src/editor/orbit-shooting';
import { execute } from '../src/world/engine';
import { globalSearch } from '../src/editor/global-search';
import { searchTemplates } from '../src/editor/solution-search';
import { blankStage } from '../src/stages/factory';
import { createMarker, compileMarker } from '../src/stages/goal-marker';
import ascent from '../data/stages/aefa2afd-1717-4954-9413-a63c077320e8.json';
import training from '../data/stages/34643eaf-0363-4898-b617-63e79ba47d97.json';
import type { Stage } from '../src/world/types';
import { parseStage } from '../src/stages/validation';

it('감쇠 최소제곱 보정은 연결된 제어 오차를 동시에 풀고 특이행렬은 안전하게 처리한다', () => {
  const j = [
      [1, 2],
      [3, -1],
    ],
    r = [5, 1];
  const step = dampedStep(j, r, 1e-8)!;
  expect(step[0]).toBeCloseTo(-1, 6);
  expect(step[1]).toBeCloseTo(-2, 6);
  expect(dampedStep([[0]], [1], 0)).toBeUndefined();
});
it.each([ascent, training])(
  '유한 분사 원궤도 $title를 정답 기록 없이 역산하고 실제 엔진으로 확인한다',
  (data) => {
    const s = parseStage(structuredClone(data));
    s.referencePlans = [];
    const quota = { remaining: 256, total: 256 },
      work = { trials: 0, ticks: 0, steps: 0 };
    const plans = [...orbitShooting(s, quota, work)].filter((p) => p !== undefined);
    expect(work.trials).toBeGreaterThan(0);
    expect(work.steps).toBeGreaterThan(0);
    expect(plans.some((p) => execute(s, p!).status === 'won')).toBe(true);
  },
  30000,
);
it.each([ascent, training])(
  '실제 전역 탐색 연결에서 $title의 해를 찾고 모델 전파도 검사 예산에 포함한다',
  (data) => {
    const s = parseStage(structuredClone(data));
    s.referencePlans = [];
    const r = [...globalSearch(s, searchTemplates(s), 128)].at(-1)!;
    expect(r.evaluated).toBeLessThanOrEqual(128);
    expect(r.successes).toBeGreaterThan(0);
    for (const f of r.families) expect(execute(s, f.representative).status).toBe('won');
  },
  30000,
);
it('이미 궤도를 도는 유한연료 기체의 무조작 해를 첫 실제 검사에서 찾는다', () => {
  const s = blankStage();
  delete s.launchBodyId;
  s.spawn = { position: { x: 2, y: 0 }, velocity: { x: 0, y: Math.sqrt(0.08 / 2) }, placed: true };
  s.bodies[0].mu = 0.08;
  const goal = createMarker(s, 'orbit', { x: 2, y: 0 });
  Object.assign(goal.marker!, { radius: 2, minor: 2, width: 0.2, span: 'settle', duration: 0.3 });
  Object.assign(goal, compileMarker(s, goal));
  s.goals = [goal];
  s.audit.timeLimit = 2;
  const result = [...globalSearch(s, searchTemplates(s), 1)].at(-1)!;
  expect(result.successes).toBe(1);
  expect(execute(s, result.families[0].representative).status).toBe('won');
});
