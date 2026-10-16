import { it, expect } from 'vitest';
import { complexMissions, timedMission } from './fixtures/complex-missions';
import { execute, createRun, tick } from '../src/world/engine';
import { controlEngine } from '../src/world/rocket';
import { globalSearch } from '../src/editor/global-search';
import { searchTemplates, type SolutionFamily } from '../src/editor/solution-search';
import { issues } from '../src/stages/validation';

const cases = complexMissions();
it.each(cases.flatMap((c) => [timedMission(c, 0.8), c, timedMission(c, 1.25)]))(
  '$id: 실제 해와 필수 과정을 생략한 반례가 시간·중력·추력 축척 후에도 구별된다',
  (c) => {
    expect(issues(c.stage)).toEqual([]);
    expect(c.stage.referencePlans).toEqual([]);
    expect(execute(c.stage, c.witness).status).toBe('won');
    for (const p of c.negative) expect(execute(c.stage, p).status).not.toBe('won');
  },
  30000,
);
it.each(cases)(
  '$id: 검증 비행을 제거한 전역 탐색이 실제 성공 대표를 찾는다',
  (c) => {
    const s = structuredClone(c.stage);
    s.referencePlans = [];
    delete s.randomization;
    const iterator = globalSearch(s, searchTemplates(s), 512);
    let found: SolutionFamily[] = [];
    for (const r of iterator)
      if (r.families.length) {
        found = r.families;
        break;
      }
    iterator.return(undefined);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found)
      expect(execute(s, f.representative, false, f.horizon).status).toBe('won');
  },
  60000,
);
it('착륙한 분리체의 엔진 끄기는 멱등적이고, 지상 재점화·자세 변경은 여전히 거절한다', () => {
  const c = cases.find((c) => c.id === 'separated-booster-recovery')!,
    r = createRun(c.stage, c.witness),
    id = c.stage.rocket!.parts[0].id;
  while (r.status === 'running' && !r.detached.some((a) => a.id === id && a.status === 'landed'))
    tick(r, c.stage, 0.1, c.stage.objects, false);
  expect(r.status).toBe('running');
  const ignitions = r.detached[0].ignitions;
  expect(controlEngine(r, c.stage, id, 0)).toBe(true);
  expect(controlEngine(r, c.stage, id, 0)).toBe(true);
  expect(controlEngine(r, c.stage, id, 1)).toBe(false);
  expect(controlEngine(r, c.stage, id, undefined, { x: 0, y: 1 })).toBe(false);
  expect(r.detached[0].ignitions).toBe(ignitions);
});
