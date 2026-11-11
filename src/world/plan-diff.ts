import { length } from '../physics/vector';
import type { RoutePlan } from './types';
import { apsisNames, headingLabel, type Heading } from './heading';
import { pushSize } from './program';

export type PlanChange = { label: string; before: number | string; after: number | string };
const angle = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
type Command = NonNullable<RoutePlan['engineCommands']>[number];
type Trigger = {
  at?: string;
  delay?: number;
  ref?: string;
  altitude?: number;
  atAngle?: number;
  phaseTarget?: string;
  body?: string;
};

/** What kind of control a reservation is, in the words of the timeline. */
function kindOf(c: Command) {
  if (c.releasePayload) return '탑재체 분리';
  if (c.separate) return '분리';
  if (c.burn) return '연소';
  if (c.throttle !== undefined) return c.throttle > 0 ? '출력' : '끄기';
  return '회전';
}
/** "출력 2": the second 출력 in the plan (names stay put when other kinds are added). */
function names(commands: Command[]) {
  const seen: Record<string, number> = {};
  return commands.map((c) => {
    const k = kindOf(c);
    seen[k] = (seen[k] ?? 0) + 1;
    return `${k} ${seen[k]}`;
  });
}
const whenText = (t: Trigger) =>
  !t.at
    ? '정한 시각'
    : t.at === 'after'
      ? '앞 예약 뒤'
      : apsisNames[t.at as keyof typeof apsisNames];
const frameText = (h?: Heading) => (h ? headingLabel({ ...h, angle: 0 }) : '지도 기준');

/**
 * Compare experimental inputs, independent of generated IDs and recorded flight length.
 * Every value a player sets is covered, under the name the timeline gives it, so a
 * comparison of two flights lists exactly what was changed between them.
 */
export function planChanges(
  a: RoutePlan,
  b: RoutePlan,
  /** Names bodies and objects for display (ids otherwise). */
  nameOf: (id: string) => string = (id) => id,
): PlanChange[] {
  const changes: PlanChange[] = [];
  const named = (id?: string) => (id ? nameOf(id) || id : '자동');
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
  const text = (label: string, before: string, after: string) => {
    if (before !== after) changes.push({ label, before, after });
  };
  const optional = (label: string, before?: number, after?: number) => {
    if (before !== undefined && after !== undefined) number(label, before, after);
    else if (before !== after)
      changes.push({ label, before: before ?? '없음', after: after ?? '없음' });
  };
  /** The when of a reservation: its event, and the number that event takes. */
  const trigger = (name: string, x: Trigger, y: Trigger, tx: number, ty: number) => {
    text(name + ' 언제', whenText(x), whenText(y));
    if ((x.at ?? '') !== (y.at ?? '')) return;
    if (!x.at) number(name + ' 시각', tx, ty);
    else if (x.at === 'after') optional(name + ' 간격', x.delay, y.delay);
    else if (x.at === 'altitude' || x.at === 'near')
      optional(name + (x.at === 'near' ? ' 거리' : ' 높이'), x.altitude, y.altitude);
    else if (x.at === 'angle' || x.at === 'phase') optional(name + ' 각도', x.atAngle, y.atAngle);
    // A trigger armed after another reservation waits from there: its clock is not a value.
    if (x.at && x.at !== 'after' && !x.ref && !y.ref) number(name + ' 거는 시각', tx, ty);
    if ((x.phaseTarget ?? '') !== (y.phaseTarget ?? ''))
      text(name + ' 대상', named(x.phaseTarget), named(y.phaseTarget));
    if ((x.body ?? '') !== (y.body ?? '')) text(name + ' 기준 천체', named(x.body), named(y.body));
  };
  const heading = (name: string, x?: Heading, y?: Heading) => {
    text(name + ' 기준 방향', frameText(x), frameText(y));
    if (x && y && x.frame === y.frame) {
      number(name + ' 기울기', x.angle, y.angle);
      if ((x.body ?? '') !== (y.body ?? ''))
        text(name + ' 방향 기준 천체', named(x.body), named(y.body));
      if ((x.targetId ?? '') !== (y.targetId ?? ''))
        text(name + ' 대상', named(x.targetId), named(y.targetId));
    }
  };

  number('첫 출력', length(a.launch), length(b.launch));
  if (length(a.launch) > 1e-8 && length(b.launch) > 1e-8)
    number('첫 방향', angle(a.launch), angle(b.launch), true);
  optional('발사 연소 Δv', a.launchDv, b.launchDv);
  text('발사 시점', a.launchHold ? '목표 각도' : '바로', b.launchHold ? '목표 각도' : '바로');
  if (a.launchHold && b.launchHold) number('발사 각도', a.launchHold.atAngle, b.launchHold.atAngle);

  const commandsA = a.engineCommands ?? [],
    commandsB = b.engineCommands ?? [];
  if (commandsA.length !== commandsB.length)
    changes.push({ label: '엔진 예약 개수', before: commandsA.length, after: commandsB.length });
  else {
    const labels = names(commandsA);
    commandsA.forEach((c, i) => {
      const d = commandsB[i],
        name = labels[i];
      if (kindOf(c) !== kindOf(d)) {
        changes.push({ label: name + ' 종류', before: kindOf(c), after: kindOf(d) });
        return;
      }
      if (c.actorId !== d.actorId)
        changes.push({ label: name + ' 대상', before: c.actorId, after: d.actorId });
      if (c.burn && d.burn) {
        number(name + ' Δv', c.burn.dv, d.burn.dv);
        heading(name, c.burn.heading, d.burn.heading);
        trigger(name, c.burn, d.burn, c.time, d.time);
        return;
      }
      trigger(name, c, d, c.time, d.time);
      if (c.throttle !== undefined && d.throttle !== undefined && c.throttle > 0)
        number(name + ' 출력', c.throttle, d.throttle);
      if (c.direction && d.direction)
        number(name + ' 방향', angle(c.direction), angle(d.direction), true);
      else if (c.heading || d.heading || !!c.direction !== !!d.direction)
        heading(name, c.heading, d.heading);
    });
  }
  if (a.impulses.length !== b.impulses.length)
    changes.push({ label: '수정 추진 개수', before: a.impulses.length, after: b.impulses.length });
  else
    a.impulses.forEach((c, i) => {
      const d = b.impulses[i],
        name = `추진 ${i + 1}`;
      trigger(name, c, d, c.time, d.time);
      number(name + ' 세기', pushSize(c), pushSize(d));
      if (!c.heading && !d.heading) number(name + ' 방향', angle(c.vector), angle(d.vector), true);
      else heading(name, c.heading, d.heading);
    });
  return changes;
}

export function singleVariableChange(a: RoutePlan, b: RoutePlan) {
  const changes = planChanges(a, b);
  return (
    changes.length === 1 &&
    !/개수|대상|종류|기준 방향|언제|발사 시점|기준 천체/.test(changes[0].label)
  );
}

/** Timeline names of a plan's reservations by id ("출력 1", "추진 2"). */
export function controlNames(plan: RoutePlan): Record<string, string> {
  const commands = plan.engineCommands ?? [];
  const labels = names(commands);
  return Object.fromEntries([
    ...commands.map((c, i) => [c.id, labels[i]]),
    ...plan.impulses.map((c, i) => [c.id, `추진 ${i + 1}`]),
  ]);
}
