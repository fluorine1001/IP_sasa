import { it, expect } from 'vitest';
import { blankStage, emptyStage } from '../src/stages/factory';
import { createMarker, compileMarker } from '../src/stages/goal-marker';
import { parseStage, issues } from '../src/stages/validation';
import { restoreDraft } from '../src/editor/draft';
import { execute, createRun, tick } from '../src/world/engine';
import { blockerProposals } from '../src/editor/blockers';
import { searchFitness } from '../src/editor/search-fitness';
import { flightShape, similarFlights } from '../src/editor/flight-shape';
import { mergeOverlappingFamilies } from '../src/editor/solution-groups';
import type { RoutePlan } from '../src/world/types';

it('새 문서는 장면·기체·목표가 비어 있고 미완성 초안 복구와 실행 검사를 구분한다', () => {
  const s = emptyStage();
  expect(s.bodies).toEqual([]);
  expect(s.goals).toEqual([]);
  expect(s.rocket).toBeUndefined();
  expect(s.spawn.placed).toBe(false);
  expect(parseStage(s, true)).toEqual(s);
  expect(() => parseStage(s)).toThrow('판정');
  expect(restoreDraft(JSON.stringify(s), blankStage()).stage).toEqual(s);
  expect(() => parseStage({ ...s, published: true }, true)).toThrow();
  expect(() => parseStage({ ...s, published: undefined }, true)).toThrow();
});
it('천체 없는 자유 공간 출발과 고정 좌표 영역을 실제로 판정한다', () => {
  const s = emptyStage();
  s.spawn.placed = true;
  s.rules.maxTime = 3;
  s.rules.timelineDuration = 3;
  const goal = createMarker(s, 'area', { x: 1, y: 0 });
  goal.marker!.span = 'instant';
  Object.assign(goal, compileMarker(s, goal));
  s.goals = [goal];
  expect(issues(s)).toEqual([]);
  expect(execute(s, { launch: { x: 0.5, y: 0 }, impulses: [] }).status).toBe('won');
  expect(execute(s, { launch: { x: 0, y: 0.5 }, impulses: [] }).status).not.toBe('won');
});
it('그림으로 관리하는 판정의 차단안은 그림·조건·스키마를 일치시키고 실제 저장 표본을 막는다', () => {
  const s = blankStage();
  s.launchBodyId = undefined;
  s.rocket = undefined;
  s.bodies[0].mu = 0.000001;
  s.spawn = { position: { x: 0.8, y: 0 }, velocity: { x: -0.1, y: 0 } };
  s.rules.maxTime = 3;
  s.rules.timelineDuration = 3;
  s.audit.timeLimit = 3;
  const goal = createMarker(s, 'surface', { x: 0.6, y: 0.09 });
  s.goals = [goal];
  const plan = { launch: { x: 0, y: 0 }, impulses: [] };
  expect(execute(s, plan).status).toBe('won');
  expect(issues(s)).toEqual([]);
  const probe = structuredClone(s);
  probe.goals[0].marker!.radius *= 0.4;
  Object.assign(probe.goals[0], compileMarker(probe, probe.goals[0]));
  expect(issues(probe)).toEqual([]);
  expect(execute(probe, plan).status).not.toBe('won');
  const proposals = blockerProposals(s, {
    id: 0,
    template: '',
    representative: plan,
    count: 1,
    ranges: [],
    trail: [],
    samples: [plan],
  });
  expect(proposals.length).toBeGreaterThan(0);
  for (const proposal of proposals) {
    expect(issues(proposal.stage)).toEqual([]);
    expect(execute(proposal.stage, plan).status).not.toBe('won');
  }
});
it('시간이 달라도 같은 공간 경로·실행 원리면 합치고 다른 방향의 궤적은 구분한다', () => {
  const s = blankStage();
  const plan: RoutePlan = { launch: { x: 0.5, y: 0 }, impulses: [] };
  const run = createRun(s, plan);
  const a = flightShape(
    s,
    plan,
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 3, y: 0 },
    ],
    run,
  );
  const b = structuredClone(a);
  b.points = b.points.map((p) => ({ x: p.x + 0.01, y: p.y }));
  const c = structuredClone(a);
  c.points = c.points.map((p) => ({ x: p.x, y: -p.y }));
  expect(similarFlights(a, b)).toBe(true);
  expect(similarFlights(a, c)).toBe(false);
  const family = (id: number, shape: typeof a) => ({
    id,
    template: '',
    representative: { ...plan, launch: { x: 0.5 + id * 0.01, y: 0 } },
    samples: [{ ...plan, launch: { x: 0.5 + id * 0.01, y: 0 } }],
    count: 1,
    ranges: [],
    trail: [],
    shape,
  });
  expect(mergeOverlappingFamilies(s, [family(1, a), family(2, b), family(3, c)])).toHaveLength(2);
});
it('탐색용 오차 읽기가 실제 판정의 기록·시간 기억을 변경하지 않는다', () => {
  const s = blankStage(),
    r = createRun(s, { launch: { x: 0.2, y: 0 }, impulses: [] });
  tick(r, s, 0.1);
  const before = structuredClone(r.goals);
  const score = searchFitness(s, r);
  expect(Number.isFinite(score)).toBe(true);
  expect(r.goals).toEqual(before);
  s.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'orbitTurns', targetId: s.bodies[0].id },
    operator: 'gte',
    right: { kind: 'constant', value: 1 },
  };
  const memories = structuredClone(r.goals);
  searchFitness(s, r);
  expect(r.goals).toEqual(memories);
});
