import { constrainAuditPlan } from '../src/editor/audit';
import { it, expect } from 'vitest';
import { stages } from '../src/stages/catalog';
import {
  timelineDuration,
  commandUsage,
  canAddCommand,
  planConstraints,
} from '../src/world/program';
import { createRun, tick } from '../src/world/engine';
import { issues } from '../src/stages/validation';
import { setPath } from '../src/editor/inspector';
import type { RoutePlan } from '../src/world/types';
const stage = stages.find((s) => s.rocket)!;
const empty = (): RoutePlan => ({ launch: { x: 1, y: 0 }, impulses: [], engineCommands: [] });
it('예약 한도는 초기 발사를 제외하고 복합 명령의 각 조작을 센다', () => {
  const s = structuredClone(stage),
    p = empty();
  s.rules.commandLimits = { ignite: 1, turn: 1, stop: 0, separate: 1, push: 0 };
  expect(commandUsage(p).ignite).toBe(0);
  expect(canAddCommand(s, p, 'ignite')).toBe(true);
  expect(canAddCommand(s, p, 'stop')).toBe(false);
  p.engineCommands!.push({
    id: 'mixed',
    time: 1,
    actorId: 'craft',
    throttle: 1,
    direction: { x: 0, y: 1 },
  });
  expect(commandUsage(p)).toEqual({ ignite: 1, turn: 1, stop: 0, separate: 0, push: 0 });
  expect(canAddCommand(s, p, 'turn')).toBe(false);
  p.engineCommands!.push({ id: 'turn2', time: 2, actorId: 'craft', direction: { x: 0, y: 1 } });
  expect(planConstraints(s, p)[0]).toContain('방향 회전');
  expect(createRun(s, p).status).toBe('failed');
  p.engineCommands!.pop();
  expect(planConstraints(s, p)).toEqual([]);
  p.engineCommands = [];
  expect(canAddCommand(s, p, 'turn')).toBe(true);
});
it('예약 창이 끝나도 전체 임무 시간까지 관성 비행을 관측한다', () => {
  const s = structuredClone(stage),
    p = empty();
  s.rules.timelineDuration = 0.5;
  p.engineCommands = [{ id: 'off', time: 0.4, actorId: 'craft', throttle: 0 }];
  const run = createRun(s, p);
  tick(run, s, 0.8);
  expect(run.time).toBeCloseTo(0.8);
  expect(run.applied.has('off')).toBe(true);
  p.engineCommands[0].time = 0.51;
  expect(createRun(s, p).reason).toContain('타임라인');
  expect(s.rules.maxTime).toBeGreaterThan(0.8);
});
it('기존 스테이지는 전체 시간을 쓰고 선택 규칙을 지우면 기본값으로 돌아간다', () => {
  const s = structuredClone(stage);
  delete s.rules.timelineDuration;
  delete s.rules.commandLimits;
  expect(timelineDuration(s)).toBe(s.rules.maxTime);
  expect(canAddCommand(s, empty(), 'turn')).toBe(true);
  setPath(s, 'rules.commandLimits.turn', 2);
  expect((s.rules.commandLimits as { turn?: number } | undefined)?.turn).toBe(2);
  setPath(s, 'rules.commandLimits.turn', undefined);
  expect(Object.keys(s.rules.commandLimits!)).toHaveLength(0);
  expect(canAddCommand(s, empty(), 'turn')).toBe(true);
});
it('에디터 데이터 검사는 계획 창과 정수 예약 한도의 잘못된 값을 거부한다', () => {
  const s = structuredClone(stage);
  s.referencePlans = [];
  s.rules.timelineDuration = s.rules.maxTime + 1;
  expect(issues(s).join(' ')).toContain('타임라인 길이');
  s.rules.timelineDuration = 1;
  s.rules.commandLimits = { turn: 1.5 };
  expect(issues(s).join(' ')).toContain('예약별 한도');
  s.rules.commandLimits = { turn: 0 };
  expect(issues(s).some((x) => x.includes('예약별 한도'))).toBe(false);
});

it('반례 검사는 금지된 수정 추진을 제외해도 허용된 로켓 계획을 계속 시험한다', () => {
  const s = structuredClone(stage),
    p = empty();
  s.rules.commandLimits = { push: 0, ignite: 1, turn: 1, stop: 0 };
  p.impulses = [{ id: 'forbidden', time: 1, vector: { x: 0.1, y: 0 } }];
  p.engineCommands = [
    { id: 'allowed', time: 2, actorId: 'craft', throttle: 1, direction: { x: 1, y: 0 } },
    { id: 'forbidden-off', time: 3, actorId: 'craft', throttle: 0 },
  ];
  const before = JSON.stringify(p),
    legal = constrainAuditPlan(s, p);
  expect(legal.impulses).toEqual([]);
  expect(legal.engineCommands!.map((c) => c.id)).toEqual(['allowed']);
  expect(planConstraints(s, legal)).toEqual([]);
  expect(JSON.stringify(p)).toBe(before);
});
