import { untilDv, type BurnUntil } from './burn-until';
/* The orbit calculator's view of planned speed changes (AGENTS.md exception): the
 * previous flight's recorded state at a command's time, plus the planned Δv, as a
 * two-body orbit. An apsis-triggered burn is applied at that orbit's Kepler apsis.
 * Only the strongest body counts; no drag, contact, finite burn time or other body.
 * This is a calculation the player reads, never a forecast of the real flight. */
import { add, dot, length, scale, sub, type Vec } from '../physics/vector';
import { bodyPosition, bodyVelocity } from './celestial';
import { dominantBody } from './conic';
import {
  apsisFrame,
  headingIn,
  resolveHeading,
  triggerFired,
  triggerOf,
  triggerReading,
  type Apsis,
  type Heading,
  type TriggerSpec,
} from './heading';
import { propagate } from './aim';
import type { RoutePlan, Stage } from './types';

export type PreviewState = { position: Vec; velocity: Vec; time: number };
export type PlannedChange = {
  id: string;
  time: number;
  dv: number;
  heading?: Heading;
  /** A map-fixed push (cold gas without a heading). */
  vector?: Vec;
  at?: Apsis;
  trigger?: TriggerSpec;
  /** Sized by the orbit it leaves; `dv` is then the ceiling. */
  until?: BurnUntil;
  label: string;
};

/** The craft's planned Δv changes in time order (burns of the craft and cold-gas pushes). */
export function plannedChanges(plan: RoutePlan): PlannedChange[] {
  const burns = (plan.engineCommands ?? [])
    .filter((c) => c.burn && c.actorId === 'craft')
    .map((c, i) => ({
      id: c.id,
      time: c.time,
      dv: c.burn!.dv,
      until: c.burn!.until,
      heading: c.burn!.heading,
      at: c.burn!.at,
      trigger: triggerOf(c.burn!),
      label: `연소 ${i + 1}`,
    }));
  const pushes = plan.impulses.map((m, i) => ({
    id: m.id,
    time: m.time,
    dv: m.magnitude ?? length(m.vector),
    until: m.heading ? m.until : undefined,
    heading: m.heading,
    vector: m.heading ? undefined : m.vector,
    at: m.at,
    trigger: triggerOf(m),
    label: `추진 ${i + 1}`,
  }));
  return [...burns, ...pushes].sort((a, b) => a.time - b.time);
}

/** The two-body apsis state after `from` (radius and speed from energy and angular momentum). */
export function keplerApsis(
  stage: Stage,
  from: PreviewState,
  at: 'apoapsis' | 'periapsis',
): PreviewState | undefined {
  const body = dominantBody(stage, from.position, from.time);
  if (!body || !(body.mu > 0)) return;
  const frame = apsisFrame(stage, from.position, from.velocity, from.time, at);
  if (!frame) return;
  const centre = bodyPosition(stage, body, from.time),
    bodyV = bodyVelocity(stage, body, from.time);
  const r = sub(from.position, centre),
    v = sub(from.velocity, bodyV);
  const energy = dot(v, v) / 2 - body.mu / length(r),
    h = Math.abs(r.x * v.y - r.y * v.x);
  if (energy >= 0 && at === 'apoapsis') return; // an open orbit has no highest point
  // r² · 2E + 2μ r − h² = 0 → the two apsis radii.
  const a = 2 * energy,
    b = 2 * body.mu,
    c = -h * h;
  const disc = Math.sqrt(Math.max(0, b * b - 4 * a * c));
  const roots = Math.abs(a) < 1e-12 ? [-c / b] : [(-b + disc) / (2 * a), (-b - disc) / (2 * a)];
  const valid = roots.filter((x) => x > 0 && Number.isFinite(x));
  if (!valid.length) return;
  const radius = at === 'apoapsis' ? Math.max(...valid) : Math.min(...valid);
  const speed = h / radius;
  return {
    position: add(centre, scale(frame.outward, radius)),
    velocity: add(bodyV, scale(frame.prograde, speed)),
    // The moment is unknown without propagating; the calculator needs only the state.
    time: from.time,
  };
}

/** Apply a planned change to a state: the Δv in its heading at that state. */
export function applyChange(stage: Stage, s: PreviewState, change: PlannedChange): PreviewState {
  const direction = change.vector
    ? scale(change.vector, 1 / Math.max(length(change.vector), 1e-12))
    : change.heading
      ? resolveHeading(stage, s.position, s.velocity, s.time, change.heading)
      : { x: 0, y: 0 };
  const dv = change.until
    ? untilDv(stage, s.position, s.velocity, s.time, direction, change.until, change.dv)
    : change.dv;
  return { ...s, velocity: add(s.velocity, scale(direction, dv)) };
}

/**
 * States right after each previewable planned change. `recorded(t)` returns the previous
 * flight's state at time t when the plan up to t is unchanged from that flight, else
 * undefined. A change that follows another planned change can be previewed only when
 * it waits for an apsis (the two-body orbit gives that state without a clock).
 */
export function previewStates(
  stage: Stage,
  plan: RoutePlan,
  recorded: (time: number) => PreviewState | undefined,
  /** State right after launch when no flight is recorded yet (the launch approximation). */
  start?: PreviewState,
): { change: PlannedChange; state: PreviewState; before: PreviewState }[] {
  const out: { change: PlannedChange; state: PreviewState; before: PreviewState }[] = [];
  let chain: PreviewState | undefined = recorded(0) ? undefined : start;
  let previous: PlannedChange | undefined;
  for (const change of plannedChanges(plan)) {
    const prior = previous;
    previous = change;
    let before: PreviewState | undefined;
    if (change.at === 'apoapsis' || change.at === 'periapsis') {
      const from = chain ?? recorded(change.time);
      before = from && keplerApsis(stage, from, change.at);
      // Its moment, for drawing on the clock: coast the same two-body orbit to it.
      if (before && from) {
        const timed = coastUntil(
          stage,
          from,
          { at: change.at },
          undefined,
          change.trigger?.ref ? undefined : change.time,
        );
        if (timed) before = { ...before, time: timed.time };
      }
      if (before && change.heading && change.heading.frame !== 'match') {
        const frame = apsisFrame(stage, from!.position, from!.velocity, from!.time, change.at);
        if (frame) {
          const dir = headingIn(frame, change.heading);
          const dv = change.until
            ? untilDv(
                stage,
                before.position,
                before.velocity,
                before.time,
                dir,
                change.until,
                change.dv,
              )
            : change.dv;
          const after = { ...before, velocity: add(before.velocity, scale(dir, dv)) };
          out.push({ change, state: after, before });
          chain = after;
          continue;
        }
      }
    } else if (
      change.trigger &&
      (change.at === 'after' ||
        change.at === 'angle' ||
        change.at === 'phase' ||
        change.at === 'near')
    ) {
      // Coast on the two-body orbit until the trigger: from the state right after the
      // previous change ('after' measures from it), or from the record at the arming time.
      const from =
        change.at === 'after'
          ? (prior && change.trigger.ref === prior.id) ||
            (!prior && change.trigger.ref === 'launch')
            ? chain
            : undefined
          : (chain ?? recorded(change.time));
      // A trigger armed by its own time (not chained) only starts waiting then.
      const armedAt = change.trigger.ref ? undefined : change.time;
      before = from && coastUntil(stage, from, change.trigger, prior?.id, armedAt);
    } else if (!chain && change.at !== 'altitude') before = recorded(change.time);
    if (!before) {
      chain = undefined;
      continue;
    }
    const after = applyChange(stage, before, change);
    out.push({ change, state: after, before });
    chain = after;
  }
  return out;
}

/**
 * Coast a state on the two-body orbit of the body pulling hardest until an event
 * trigger fires ('after': the delay from `from`, which is when `refId` finished;
 * 'angle'/'phase': the angle crossing). Undefined if it does not fire within 600 s.
 */
export function coastUntil(
  stage: Stage,
  from: PreviewState,
  trigger: TriggerSpec,
  refId?: string,
  /** Start waiting only from this time (an item armed by its own clock time). */
  armedAt?: number,
): PreviewState | undefined {
  const body = dominantBody(stage, from.position, from.time);
  if (!body || !(body.mu > 0)) return;
  const c0 = bodyPosition(stage, body, from.time),
    w0 = bodyVelocity(stage, body, from.time);
  const r0 = sub(from.position, c0),
    v0 = sub(from.velocity, w0);
  const at = (dt: number): PreviewState => {
    const s = propagate(body.mu, r0, v0, dt);
    const t = from.time + dt;
    return {
      position: add(bodyPosition(stage, body, t), s.r),
      velocity: add(bodyVelocity(stage, body, t), s.v),
      time: t,
    };
  };
  if (trigger.at === 'after') return at(Math.max(0, trigger.delay ?? 0));
  const fired = (a: PreviewState, b: PreviewState) =>
    triggerFired(
      trigger,
      triggerReading(stage, a.position, a.velocity, a.time, trigger.phaseTarget),
      triggerReading(stage, b.position, b.velocity, b.time, trigger.phaseTarget),
      refId ? { [refId]: from.time } : undefined,
    );
  const step = 0.05;
  const first = Math.max(0, (armedAt ?? from.time) - from.time);
  let prev = at(first);
  for (let dt = first + step; dt <= first + 600; dt += step) {
    const next = at(dt);
    if (fired(prev, next)) {
      let lo = dt - step,
        hi = dt;
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (fired(at(lo), at(m))) hi = m;
        else lo = m;
      }
      return at(hi);
    }
    prev = next;
  }
  return undefined;
}
