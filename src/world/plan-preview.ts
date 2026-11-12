import { gravity } from './celestial';
/* The orbit calculator's view of planned speed changes (AGENTS.md exception): the
 * previous flight's recorded state at a command's time, plus the planned Δv, as a
 * two-body orbit. An apsis-triggered burn is applied at that orbit's Kepler apsis.
 * Only the strongest body counts; no drag, contact, finite burn time or other body.
 * This is a calculation the player reads, never a forecast of the real flight. */
import { launchFraction } from './program';
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
  referenceBody,
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
  label: string;
  /** An engine burn of finite length: integrated, not applied at once. */
  burn?: { thrust: number; mass: number; exhaust: number; seconds: number };
};

/** The craft's planned Δv changes in time order (burns of the craft and cold-gas pushes). */
/**
 * A 출력 … 끄기 pair of the craft as one speed change for the calculator: its length is
 * the cut's delay after the light (or the clock gap), its size the rocket equation on
 * the stage then firing (fuel taken as full: an estimate), its direction the turn held
 * before it. Pairs whose length or stage cannot be read are left out.
 */
function enginePairs(stage: Stage | undefined, plan: RoutePlan): PlannedChange[] {
  const config = stage?.rocket;
  const parts = config?.parts;
  if (!config || !parts) return [];
  const all = plan.engineCommands ?? [];
  const craft = all.filter((c) => c.actorId === 'craft' && !c.burn);
  const order = [...craft].sort((a, b) => a.time - b.time);
  // The fuel ledger of the plan, in the order it runs: what each burn starts with is what
  // the burns before it left (the launch burn, earlier burns, dropped stages and payloads).
  const fuel = parts.map((p) => p.fuelMass);
  let index = 0;
  let released = 0;
  const mass = () =>
    (config.payloadMass ?? 0) +
    (config.payloads ?? []).reduce((m, q) => m + q.mass, 0) -
    released +
    parts.slice(index).reduce((m, p, i) => m + p.dryMass + fuel[index + i], 0);
  const burn = (part: number, used: number) => {
    const before = mass();
    const spent = Math.max(0, Math.min(fuel[part], used));
    fuel[part] -= spent;
    return parts[part].exhaustSpeed * Math.log(before / Math.max(1e-12, before - spent));
  };
  // The launch: its Δv when set, otherwise its stage burned until the first cut or empty.
  const power = Math.min(1, launchFraction(stage!, plan));
  if (power > 0) {
    const p = parts[0];
    if (plan.launchDv !== undefined)
      burn(0, mass() * (1 - Math.exp(-plan.launchDv / p.exhaustSpeed)));
    else {
      const firstCut = order.find((c) => c.throttle === 0);
      const seconds = firstCut ? Math.max(0, firstCut.time) : Infinity;
      burn(0, ((p.thrust * power) / p.exhaustSpeed) * seconds);
    }
  }
  const out: PlannedChange[] = [];
  let lights = 0;
  for (const c of order) {
    if (c.separate) {
      index++;
      continue;
    }
    if (c.releasePayload) {
      released += config.payloads?.find((q) => q.id === c.releasePayload)?.mass ?? 0;
      continue;
    }
    if (!((c.throttle ?? 0) > 0)) continue;
    const light = c;
    lights++;
    const cut =
      craft.find((x) => x.throttle === 0 && x.at === 'after' && x.ref === light.id) ??
      order.find((x) => x.throttle === 0 && x.time > light.time && x.at !== 'after');
    if (!cut) continue;
    const length =
      cut.at === 'after' && cut.ref === light.id ? (cut.delay ?? 0) : cut.time - light.time;
    // The turn it follows: the one it is chained to, else the latest turn before it.
    const turn =
      craft.find((x) => x.id === light.ref && (x.heading || x.direction)) ??
      [...order].reverse().find((x) => x.time <= light.time && (x.heading || x.direction));
    const part = parts[index];
    if (!part || length <= 0) continue;
    const startMass = mass();
    const dv = burn(index, ((part.thrust * light.throttle!) / part.exhaustSpeed) * length);
    const seconds = Math.min(
      length,
      (part.exhaustSpeed * (startMass - mass())) / (part.thrust * light.throttle! || 1),
    );
    if (!turn) continue;
    out.push({
      id: light.id,
      time: light.time,
      dv,
      heading: turn.heading,
      vector: turn.heading ? undefined : turn.direction,
      at: light.at,
      trigger: triggerOf(light),
      label: `출력 ${lights}`,
      burn: {
        thrust: part.thrust * light.throttle!,
        mass: startMass,
        exhaust: part.exhaustSpeed,
        seconds,
      },
    });
  }
  return out;
}
export function plannedChanges(plan: RoutePlan, stage?: Stage): PlannedChange[] {
  const burns = (plan.engineCommands ?? [])
    .filter((c) => c.burn && c.actorId === 'craft')
    .map((c, i) => ({
      id: c.id,
      time: c.time,
      dv: c.burn!.dv,
      heading: c.burn!.heading,
      at: c.burn!.at,
      trigger: triggerOf(c.burn!),
      label: `연소 ${i + 1}`,
    }));
  const pushes = plan.impulses.map((m, i) => ({
    id: m.id,
    time: m.time,
    dv: m.magnitude ?? length(m.vector),
    heading: m.heading,
    vector: m.heading ? undefined : m.vector,
    at: m.at,
    trigger: triggerOf(m),
    label: `추진 ${i + 1}`,
  }));
  return [...burns, ...enginePairs(stage, plan), ...pushes].sort((a, b) => a.time - b.time);
}

/** The two-body apsis state after `from` (radius and speed from energy and angular momentum). */
export function keplerApsis(
  stage: Stage,
  from: PreviewState,
  at: 'apoapsis' | 'periapsis',
  bodyId?: string,
): PreviewState | undefined {
  const body = referenceBody(stage, from.position, from.time, bodyId);
  if (!body || !(body.mu > 0)) return;
  const frame = apsisFrame(stage, from.position, from.velocity, from.time, at, body.id);
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
  if (change.burn && change.burn.seconds > 0) return finiteBurn(stage, s, change, change.burn);
  const direction = change.vector
    ? scale(change.vector, 1 / Math.max(length(change.vector), 1e-12))
    : change.heading
      ? resolveHeading(stage, s.position, s.velocity, s.time, change.heading)
      : { x: 0, y: 0 };
  return { ...s, velocity: add(s.velocity, scale(direction, change.dv)) };
}

/**
 * An engine burn as it runs: thrust along the held direction while the stack lightens,
 * under the one body whose sphere the craft is in (the same gravity the flight uses;
 * air is left out). The state at the cut.
 */
function finiteBurn(
  stage: Stage,
  s: PreviewState,
  change: PlannedChange,
  b: NonNullable<PlannedChange['burn']>,
): PreviewState {
  const steps = Math.max(20, Math.ceil(b.seconds / 0.005)),
    dt = b.seconds / steps,
    flow = b.thrust / b.exhaust;
  let p = s.position,
    v = s.velocity,
    t = s.time,
    m = b.mass;
  const accel = (pos: Vec, vel: Vec, time: number, mass: number) => {
    const dir = change.vector
      ? scale(change.vector, 1 / Math.max(length(change.vector), 1e-12))
      : change.heading
        ? resolveHeading(stage, pos, vel, time, change.heading)
        : { x: 0, y: 0 };
    return add(gravity(stage, pos, time), scale(dir, b.thrust / mass));
  };
  for (let i = 0; i < steps; i++) {
    // Midpoint step: enough for a burn of a few tenths of a second.
    const a1 = accel(p, v, t, m);
    const pm = add(p, scale(v, dt / 2)),
      vm = add(v, scale(a1, dt / 2));
    const a2 = accel(pm, vm, t + dt / 2, m - (flow * dt) / 2);
    p = add(p, scale(vm, dt));
    v = add(v, scale(a2, dt));
    t += dt;
    m -= flow * dt;
  }
  return { position: p, velocity: v, time: t };
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
  /** When each reservation acted in the recorded flight (its black box). */
  fired?: Record<string, number>,
): { change: PlannedChange; state: PreviewState; before: PreviewState }[] {
  const out: { change: PlannedChange; state: PreviewState; before: PreviewState }[] = [];
  let chain: PreviewState | undefined = recorded(0) ? undefined : start;
  let previous: PlannedChange | undefined;
  for (const change of plannedChanges(plan, stage)) {
    const prior = previous;
    previous = change;
    let before: PreviewState | undefined;
    // The flight on record already went through this moment with the same plan up to it:
    // the state it really had then is exact (air, contact and all), so the change is
    // added to that, not to a two-body guess of when its event would come.
    const seen = fired?.[change.id];
    const met = seen !== undefined ? recorded(seen) : undefined;
    if (met) {
      const after = applyChange(stage, met, change);
      out.push({ change, state: after, before: met });
      chain = after;
      continue;
    }
    if (change.at === 'apoapsis' || change.at === 'periapsis') {
      const from = chain ?? recorded(change.time);
      before = from && keplerApsis(stage, from, change.at, change.trigger?.body);
      // Its moment, for drawing on the clock: coast the same two-body orbit to it.
      if (before && from) {
        const timed = coastUntil(
          stage,
          from,
          { at: change.at, body: change.trigger?.body },
          undefined,
          change.trigger?.ref ? undefined : change.time,
        );
        if (timed) before = { ...before, time: timed.time };
      }
      if (before && change.heading && change.heading.frame !== 'match') {
        const frame = apsisFrame(
          stage,
          from!.position,
          from!.velocity,
          from!.time,
          change.at,
          change.trigger?.body,
        );
        if (frame) {
          const after = {
            ...before,
            velocity: add(before.velocity, scale(headingIn(frame, change.heading), change.dv)),
          };
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
  const body = referenceBody(stage, from.position, from.time, trigger.body);
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
      triggerReading(stage, a.position, a.velocity, a.time, trigger.phaseTarget, body.id),
      triggerReading(stage, b.position, b.velocity, b.time, trigger.phaseTarget, body.id),
      refId ? { [refId]: from.time } : undefined,
    );
  const step = 0.05;
  const first = Math.max(0, (armedAt ?? from.time) - from.time);
  // Nothing after the mission ends can be planned for: search no further than its clock.
  const limit = typeof stage.rules.maxTime === 'number' ? stage.rules.maxTime : from.time + 600;
  const horizon = Math.min(first + 600, Math.max(first, limit - from.time));
  let prev = at(first);
  for (let dt = first + step; dt <= horizon; dt += step) {
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
