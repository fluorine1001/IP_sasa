import { it, expect } from 'vitest';
import { stages } from '../src/stages/catalog';
import { createRun, tick, execute } from '../src/world/engine';
import { planningTimeLimit, missionTimeLimit, planConstraints } from '../src/world/program';
import { issues, parseStage } from '../src/stages/validation';
it('무제한 시간은 JSON 왕복 후에도 유지되며 초기 표시 길이를 넘겨 예약한다', () => {
  const s = structuredClone(stages.find((s) => s.rocket)!);
  s.rules.maxTime = 1;
  s.rules.timelineDuration = 0.5;
  s.rules.timelineUnlimited = true;
  s.rules.maxTimeUnlimited = true;
  s.goals.forEach((g) => (g.endTimeUnlimited = true));
  s.referencePlans = [];
  delete s.randomization;
  const saved = parseStage(JSON.parse(JSON.stringify(s)));
  expect(planningTimeLimit(saved)).toBe(Infinity);
  expect(missionTimeLimit(saved)).toBe(Infinity);
  expect(
    planConstraints(saved, {
      launch: { x: 0, y: 0 },
      impulses: [],
      engineCommands: [{ id: 'late', actorId: 'craft', time: 1000, throttle: 0 }],
    }),
  ).toEqual([]);
  expect(JSON.stringify(saved)).not.toContain('Infinity');
});
it('무제한 임무는 표시 길이와 목표의 옛 종료시각 이후에도 판정하고 자동 검사는 유한하게 끝난다', () => {
  const s = structuredClone(stages.find((s) => s.rocket)!);
  s.rules.maxTime = 0.1;
  s.rules.maxTimeUnlimited = true;
  s.rules.timelineUnlimited = true;
  s.audit.timeLimit = 0.2;
  s.referencePlans = [];
  s.goals = [
    {
      ...s.goals[0],
      startTime: 0,
      endTime: 0.1,
      endTimeUnlimited: true,
      dependsOn: [],
      condition: {
        kind: 'compare',
        left: { kind: 'metric', metric: 'time', targetId: '', actorId: 'craft' },
        operator: 'gte',
        right: { kind: 'constant', value: 0.3 },
      },
    },
  ];
  const p = { launch: { x: 0, y: 0 }, impulses: [] };
  const r = createRun(s, p);
  tick(r, s, 0.2);
  expect(r.status).toBe('running');
  expect(r.time).toBeCloseTo(0.2);
  const checked = execute(s, p);
  expect(checked.status).toBe('observed');
  expect(checked.time).toBeCloseTo(0.2);
  tick(r, s, 0.2);
  expect(r.status).toBe('won');
  expect(r.time).toBeGreaterThan(0.1);
});
it('유한한 임무 종료와 무제한 계획은 독립적으로 선택하며 임무 이후 예약은 거부한다', () => {
  const s = structuredClone(stages[0]);
  s.rules.timelineUnlimited = true;
  expect(planningTimeLimit(s)).toBe(s.rules.maxTime);
  expect(
    planConstraints(s, {
      launch: { x: 0, y: 0 },
      impulses: [{ id: 'late', time: s.rules.maxTime + 1, vector: { x: 0, y: 0 } }],
    }),
  ).not.toEqual([]);
  s.audit.timeLimit = Infinity;
  expect(issues(s).join(' ')).toContain('자동 검사 시간');
});
