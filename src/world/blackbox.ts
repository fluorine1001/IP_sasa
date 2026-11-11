/*
 * The flight's black box: what each reservation actually met when it acted. Pure
 * observation of the flight that happened (no prediction, no advice): the moment, the
 * body it was read around, height and speeds there, the distance and relative speed to
 * the thing it watched, and for an engine cut the speed change the burn really gave.
 */
import { length, sub, dot, type Vec } from '../physics/vector';
import { bodyPosition, bodyVelocity, objectPosition, objectVelocity } from './celestial';
import { referenceBody } from './heading';
import { rocketMass } from './rocket';
import type { Run, Stage } from './types';

export type BlackboxEntry = {
  time: number;
  /** The body heights and speeds are read around. */
  body?: string;
  height?: number;
  /** Speed relative to that body, and its up/down part (+ away). */
  speed?: number;
  radial?: number;
  /** The watched target (match turn, phase/near trigger): distance and relative speed. */
  target?: string;
  gap?: number;
  relSpeed?: number;
  /** Engine light: the stack's mass and stage then (to measure the burn at its cut). */
  mass?: number;
  part?: number;
  /** Engine cut: the speed change the burn delivered (rocket equation on fuel used). */
  dv?: number;
};
export type Blackbox = Record<string, BlackboxEntry>;

type Item = {
  id: string;
  actorId?: string;
  throttle?: number;
  ref?: string;
  body?: string;
  phaseTarget?: string;
  heading?: { targetId?: string; body?: string };
};

function actorOf(run: Run, actorId = 'craft') {
  if (actorId === 'craft') return { position: run.position, velocity: run.velocity };
  return run.detached.find((d) => d.id === actorId);
}
function massOf(run: Run, stage: Stage, actorId = 'craft') {
  if (!stage.rocket || !run.rocket) return undefined;
  if (actorId === 'craft') return rocketMass(stage, run);
  const a = run.detached.find((d) => d.id === actorId);
  return a ? a.dryMass + a.fuel : undefined;
}
function exhaustOf(run: Run, stage: Stage, actorId = 'craft') {
  const parts = stage.rocket?.parts;
  if (!parts || !run.rocket) return undefined;
  if (actorId === 'craft') return parts[run.rocket.partIndex]?.exhaustSpeed;
  return parts.find((p) => p.id === actorId)?.exhaustSpeed;
}
function targetState(stage: Stage, id: string, time: number) {
  const b = stage.bodies.find((x) => x.id === id);
  if (b) return { p: bodyPosition(stage, b, time), v: bodyVelocity(stage, b, time) };
  const o = stage.objects.find((x) => x.id === id);
  if (o) return { p: objectPosition(stage, o, time), v: objectVelocity(stage, o, time) };
  return undefined;
}

function holdTarget(run: Run, actorId: string) {
  return run.holding?.find((h) => h.actorId === actorId)?.heading.targetId;
}
/** Record every reservation that acted since the last call (run.firedAt is the log). */
export function recordBlackbox(run: Run, stage: Stage) {
  const fired = run.firedAt;
  if (!fired) return;
  const box = (run.blackbox ??= {});
  const plan = run.initialPlan ?? run.plan;
  const items: Item[] = [...(plan.engineCommands ?? []), ...plan.impulses];
  for (const [id, time] of Object.entries(fired)) {
    if (box[id]) continue;
    const item = items.find((x) => x.id === id);
    const actorId = id.startsWith('launch') ? 'craft' : (item?.actorId ?? 'craft');
    const actor = actorOf(run, actorId);
    const entry: BlackboxEntry = { time };
    if (actor) {
      const body = referenceBody(
        stage,
        actor.position,
        run.time,
        item?.body ?? item?.heading?.body,
      );
      if (body) {
        const r = sub(actor.position, bodyPosition(stage, body, run.time)),
          v = sub(actor.velocity, bodyVelocity(stage, body, run.time));
        entry.body = body.id;
        entry.height = length(r) - body.radius;
        entry.speed = length(v);
        entry.radial = length(r) > 1e-9 ? dot(v, r) / length(r) : 0;
      }
      // A cut is judged against what the burn it ends was aiming at.
      const lightOf = item?.throttle === 0 && item.ref ? box[item.ref] : undefined;
      const watched =
        item?.phaseTarget ?? item?.heading?.targetId ?? lightOf?.target ?? holdTarget(run, actorId);
      const t = watched ? targetState(stage, watched, run.time) : undefined;
      if (watched && t) {
        entry.target = watched;
        entry.gap = length(sub(actor.position, t.p));
        entry.relSpeed = length(sub(actor.velocity, t.v));
      }
    }
    if (item?.throttle !== undefined && item.throttle > 0) {
      entry.mass = massOf(run, stage, actorId);
      if (actorId === 'craft') entry.part = run.rocket?.partIndex;
    }
    if (item?.throttle === 0) {
      // The light this cut ends: the one it follows, else the latest light of that engine.
      const light =
        (item.ref && box[item.ref]?.mass !== undefined ? box[item.ref] : undefined) ??
        Object.entries(box)
          .filter(([other, e]) => {
            const o = items.find((x) => x.id === other);
            return e.mass !== undefined && (o?.actorId ?? 'craft') === actorId && e.time <= time;
          })
          .sort((a, b) => b[1].time - a[1].time)[0]?.[1];
      const now = massOf(run, stage, actorId),
        ve = exhaustOf(run, stage, actorId);
      // A stage dropped in between is mass let go, not speed gained: no figure then.
      const same = actorId !== 'craft' || light?.part === run.rocket?.partIndex;
      if (light?.mass && now && ve && now <= light.mass && same)
        entry.dv = ve * Math.log(light.mass / now);
    }
    box[id] = entry;
  }
}
/** Where a body or object is, for naming it in the record. */
export function nameOf(stage: Stage, id: string | undefined) {
  if (!id) return '';
  return (
    stage.bodies.find((b) => b.id === id)?.name ??
    stage.objects.find((o) => o.id === id)?.name ??
    ''
  );
}
export type { Vec };
