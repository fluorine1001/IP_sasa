import { expect, it } from 'vitest';
import { emptyStage, newGoal } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';
import { recordTrial } from '../src/world/evidence';
import { flightLogHtml, logGroups, valueAt } from '../src/screens/flight/flight-log';

function stageWithGoal() {
  const s = emptyStage();
  s.spawn.placed = true;
  s.spawn.velocity = { x: 1, y: 0 };
  s.rules.maxTime = 1;
  const g = newGoal();
  g.endTime = 1;
  g.condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'x', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 5 },
  };
  s.goals = [g];
  return { s, g };
}

it('기록 그래프용 측정값은 요청한 비행에서만 남고 판정 결과는 같다', () => {
  const { s, g } = stageWithGoal();
  const plain = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  const logged = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  logged.recordSeries = true;
  for (let i = 0; i < 10; i++) {
    tick(plain, s, 0.1);
    tick(logged, s, 0.1);
  }
  expect(plain.goals[g.id].series).toBeUndefined();
  expect(logged.goals[g.id].complete).toBe(plain.goals[g.id].complete);
  expect(logged.goals[g.id].closest).toEqual(plain.goals[g.id].closest);
  const series = logged.goals[g.id].series!.root;
  expect(series.target).toBe(5);
  expect(series.t.length).toBeGreaterThan(5);
  // Samples are at least 0.05 s apart and keep the measured value.
  for (let i = 1; i < series.t.length; i++)
    expect(series.t[i] - series.t[i - 1]).toBeGreaterThan(0.049);
  expect(valueAt(series, series.t[3])).toBeCloseTo(series.v[3]);
});

it('시도 기록에 측정값을 담고 목표 기준선과 함께 그린다', () => {
  const { s, g } = stageWithGoal();
  const run = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  run.recordSeries = true;
  for (let i = 0; i < 10; i++) tick(run, s, 0.1);
  const trial = recordTrial(run, 1);
  expect(Object.keys(trial.series ?? {})).toEqual([g.id]);
  const groups = logGroups(s, [trial]);
  expect(groups[0].thresholds).toEqual([{ operator: 'gte', target: 5 }]);
  const html = flightLogHtml(s, [trial], groups[0], 1, 0.5, 0, groups.length);
  expect(html).toContain('≥ 5.00');
  expect(html).toContain('1차');
  expect(html).toMatch(/<path class="log-line" d="M/);
});

it('변하지 않는 측정값은 그래프 후보에서 뺀다', () => {
  const { s, g } = stageWithGoal();
  s.spawn.velocity = { x: 0, y: 0 };
  const run = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  run.recordSeries = true;
  for (let i = 0; i < 5; i++) tick(run, s, 0.1);
  const groups = logGroups(s, [recordTrial(run, 1)]);
  expect(groups.some((x) => x.goalId === g.id)).toBe(false);
});
