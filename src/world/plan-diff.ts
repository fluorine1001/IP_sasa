import { length } from '../physics/vector';
import type { RoutePlan } from './types';

export type PlanChange = { label: string; before: number | string; after: number | string };
const angle = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/** Compare experimental inputs, independent of generated IDs and recorded flight length. */
export function planChanges(a: RoutePlan, b: RoutePlan): PlanChange[] {
  const changes: PlanChange[] = [];
  const number = (label: string, before: number, after: number, circular = false) => {
    const delta = circular
      ? (Math.atan2(
          Math.sin(((after - before) * Math.PI) / 180),
          Math.cos(((after - before) * Math.PI) / 180),
        ) *
          180) /
        Math.PI
      : after - before;
    if (Math.abs(delta) > 1e-6) changes.push({ label, before, after });
  };
  number('첫 출력', length(a.launch), length(b.launch));
  if (length(a.launch) > 1e-8 && length(b.launch) > 1e-8)
    number('첫 방향', angle(a.launch), angle(b.launch), true);
  const commandsA = a.engineCommands ?? [],
    commandsB = b.engineCommands ?? [];
  if (commandsA.length !== commandsB.length)
    changes.push({ label: '엔진 예약 개수', before: commandsA.length, after: commandsB.length });
  else
    commandsA.forEach((c, i) => {
      const d = commandsB[i],
        name = `예약 ${i + 1}`;
      number(name + ' 시각', c.time, d.time);
      if (c.actorId !== d.actorId)
        changes.push({ label: name + ' 대상', before: c.actorId, after: d.actorId });
      if (!!c.separate !== !!d.separate)
        changes.push({
          label: name + ' 종류',
          before: c.separate ? '분리' : '엔진',
          after: d.separate ? '분리' : '엔진',
        });
      if (c.throttle !== undefined && d.throttle !== undefined)
        number(name + ' 출력', c.throttle, d.throttle);
      else if (c.throttle !== d.throttle)
        changes.push({
          label: name + ' 출력',
          before: c.throttle ?? '없음',
          after: d.throttle ?? '없음',
        });
      if (c.direction && d.direction)
        number(name + ' 방향', angle(c.direction), angle(d.direction), true);
      else if (!!c.direction !== !!d.direction)
        changes.push({
          label: name + ' 회전',
          before: c.direction ? '있음' : '없음',
          after: d.direction ? '있음' : '없음',
        });
    });
  if (a.impulses.length !== b.impulses.length)
    changes.push({ label: '수정 추진 개수', before: a.impulses.length, after: b.impulses.length });
  else
    a.impulses.forEach((c, i) => {
      const d = b.impulses[i],
        name = `수정 추진 ${i + 1}`;
      number(name + ' 시각', c.time, d.time);
      number(name + ' 세기', length(c.vector), length(d.vector));
      number(name + ' 방향', angle(c.vector), angle(d.vector), true);
    });
  return changes;
}

export function singleVariableChange(a: RoutePlan, b: RoutePlan) {
  const changes = planChanges(a, b);
  return changes.length === 1 && !/개수|대상|종류|회전/.test(changes[0].label);
}
