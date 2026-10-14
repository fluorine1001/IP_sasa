import { it, expect } from 'vitest';
import { emptyStage, blankStage } from '../src/stages/factory';
import { fairCases } from '../src/editor/fair-cases';
import { solutionSpace } from '../src/editor/solution-space';
import { globalSearch } from '../src/editor/global-search';
import { searchSolutions, searchParameters } from '../src/editor/solution-search';
import { execute } from '../src/world/engine';

function freeStage() {
  const s = emptyStage();
  s.spawn.placed = true;
  s.rules.maneuverBudget = 0;
  s.rules.launchLimit = 0;
  s.rules.maxTime = 1;
  s.rules.timelineDuration = 1;
  s.audit.timeLimit = 0.1;
  s.goals = [
    {
      id: 'wait',
      title: '시간 경과',
      position: { x: 0, y: 0 },
      startTime: 0,
      endTime: 1,
      dependsOn: [],
      condition: {
        kind: 'compare',
        left: { kind: 'metric', metric: 'time', targetId: '' },
        operator: 'gte',
        right: { kind: 'constant', value: 0.4 },
      },
    },
  ];
  return s;
}
it('유한 임무는 짧은 제작 검사 창에 잘리지 않고 실제 임무 시간까지 조사한다', () => {
  const s = freeStage();
  const r = [...globalSearch(s, [], 16)].at(-1)!;
  expect(r.families.length).toBe(1);
  expect(r.families[0].horizon).toBe(1);
  expect(execute(s, r.families[0].representative, false, r.families[0].horizon).status).toBe('won');
});
it('무제한 시간은 앞 창의 관측 종료를 실패로 고정하지 않고 더 긴 창에서 실제로 성공한다', () => {
  const s = freeStage();
  s.rules.maxTimeUnlimited = true;
  s.goals[0].endTimeUnlimited = true;
  const r = [...globalSearch(s, [], 24)].at(-1)!;
  expect(r.families.length).toBeGreaterThan(0);
  expect(r.scope!.horizon).toBeGreaterThanOrEqual(0.4);
  expect(execute(s, r.families[0].representative, false, r.families[0].horizon).status).toBe('won');
});
it('기본 6개를 넘는 길이와 정밀도 층에 반복적으로 계산 기회를 준다', () => {
  const s = blankStage();
  s.rules.commandLimits = undefined;
  const cases = fairCases(s);
  const layers = Array.from({ length: 16 }, () => cases.next()!);
  expect(layers.map((c) => c.level)).toEqual([0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4]);
  expect(cases.maxCommands).toBe(10);
  expect(new Set(layers.map((c) => c.coordinates.join(','))).size).toBeGreaterThan(1);
});
it('긴 비행은 실제 상태를 보존한 채 양보하고 같은 엔진의 일괄 실행과 같은 결과를 낸다', () => {
  const s = freeStage();
  s.audit.timeLimit = 4;
  s.rules.maxTime = 4;
  s.goals[0].endTime = 4;
  s.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 3.5 },
  };
  const plan = { launch: { x: 0, y: 0 }, impulses: [] };
  const reports = [
    ...searchSolutions(
      s,
      { id: 'x', label: 'x', plan, parameters: searchParameters(s, plan) },
      1,
      false,
    ),
  ];
  expect(reports.some((r) => r.pending)).toBe(true);
  expect(reports.at(-1)!.successes).toBe(1);
  expect(reports.at(-1)!.families[0].representative).toEqual(plan);
  expect(execute(s, plan, false, 4).status).toBe('won');
});
it('Number 범위를 넘는 격자 분할도 정수 순번으로 다루며 좌표가 NaN이 되지 않는다', () => {
  const s = freeStage();
  s.rules.launchLimit = 1;
  const grid = solutionSpace(s).grid(1n << 1074n);
  for (let i = 0; i < 8; i++) {
    const values = grid.next()!.coordinates;
    expect(values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
  }
});
