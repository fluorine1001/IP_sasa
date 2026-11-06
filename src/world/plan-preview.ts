/* The orbit calculator's view of planned speed changes (AGENTS.md exception): the
 * previous flight's recorded state at a command's time, plus the planned Δv, as a
 * two-body orbit. An apsis-triggered burn is applied at that orbit's Kepler apsis.
 * Only the strongest body counts; no drag, contact, finite burn time or other body.
 * This is a calculation the player reads, never a forecast of the real flight. */
import { add, dot, length, scale, sub, type Vec } from '../physics/vector';
import { bodyPosition, bodyVelocity } from './celestial';
import { dominantBody } from './conic';
import { apsisFrame, headingIn, resolveHeading, type Heading } from './heading';
import type { RoutePlan, Stage } from './types';

export type PreviewState = { position: Vec; velocity: Vec; time: number };
export type PlannedChange = {
  id: string;
  time: number;
  dv: number;
  heading?: Heading;
  /** A map-fixed push (cold gas without a heading). */
  vector?: Vec;
  at?: 'apoapsis' | 'periapsis' | 'altitude';
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
      heading: c.burn!.heading,
      at: c.burn!.at,
      label: `연소 ${i + 1}`,
    }));
  const pushes = plan.impulses.map((m, i) => ({
    id: m.id,
    time: m.time,
    dv: m.magnitude ?? length(m.vector),
    heading: m.heading,
    vector: m.heading ? undefined : m.vector,
    at: m.at,
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
  return { ...s, velocity: add(s.velocity, scale(direction, change.dv)) };
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
): { change: PlannedChange; state: PreviewState; before: PreviewState }[] {
  const out: { change: PlannedChange; state: PreviewState; before: PreviewState }[] = [];
  let chain: PreviewState | undefined;
  for (const change of plannedChanges(plan)) {
    let before: PreviewState | undefined;
    if (change.at === 'apoapsis' || change.at === 'periapsis') {
      const from = chain ?? recorded(change.time);
      before = from && keplerApsis(stage, from, change.at);
      if (before && change.heading && change.heading.frame !== 'match') {
        const frame = apsisFrame(stage, from!.position, from!.velocity, from!.time, change.at);
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
