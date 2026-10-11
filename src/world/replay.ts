import { ROCKET_SEGMENT_LENGTH } from './hull';
import { add, sub, scale } from '../physics/vector';
import type { Run, RoutePlan } from './types';

export type FlightFrame = Pick<
  Run,
  | 'time'
  | 'position'
  | 'velocity'
  | 'attitude'
  | 'status'
  | 'reason'
  | 'rocket'
  | 'detached'
  | 'bodies'
  | 'landed'
  | 'impact'
  | 'buoys'
  | 'goals'
  | 'used'
>;
export function captureFrame(run: Run, force = false) {
  const frames = (run.frames ??= []),
    last = frames.at(-1);
  if (!force && last && run.time - last.time < 0.05 - 1e-8) return;
  const {
    time,
    position,
    velocity,
    attitude,
    status,
    reason,
    rocket,
    detached,
    bodies,
    landed,
    impact,
    buoys,
    used,
  } = run;
  const goals = Object.fromEntries(
    Object.entries(run.goals).map(([id, p]) => [id, { complete: p.complete, ratio: p.ratio }]),
  );
  const frame = structuredClone({
    time,
    position,
    velocity,
    attitude,
    status,
    reason,
    rocket,
    detached,
    bodies,
    landed,
    impact,
    buoys,
    goals,
    used,
  });
  if (last && Math.abs(last.time - time) < 1e-9) frames[frames.length - 1] = frame;
  else frames.push(frame);
}
/** Playback reads captured state; it never runs physics, goals, fuel or commands. */
export function replayAt(
  frames: FlightFrame[],
  requested: number,
  plan: RoutePlan,
): Run | undefined {
  if (!frames.length) return undefined;
  const time = Math.max(frames[0].time, Math.min(requested, frames.at(-1)!.time));
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].time <= time + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  const a = frames[lo],
    b = frames[Math.min(lo + 1, frames.length - 1)],
    state = structuredClone(a);
  const alpha = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
  const mix = (p: typeof a.position, q: typeof p) => add(p, scale(sub(q, p), alpha));
  const continuousEnd =
    a.rocket && b.rocket && b.rocket.partIndex !== a.rocket.partIndex
      ? sub(
          b.position,
          scale(
            a.rocket.direction,
            (b.rocket.partIndex - a.rocket.partIndex) * ROCKET_SEGMENT_LENGTH,
          ),
        )
      : b.position;
  state.position = mix(a.position, continuousEnd);
  state.velocity = mix(a.velocity, b.velocity);
  state.time = time;
  for (const actor of state.detached) {
    const next = b.detached.find((x) => x.id === actor.id);
    if (next && next.status === actor.status) actor.position = mix(actor.position, next.position);
  }
  for (const [id, body] of Object.entries(state.bodies ?? {})) {
    const next = b.bodies?.[id];
    if (next) body.position = mix(body.position, next.position);
  }
  for (const buoy of state.buoys) {
    const next = b.buoys.find((x) => x.id === buoy.id);
    if (next && Number.isFinite(buoy.lastSample) === Number.isFinite(next.lastSample))
      buoy.position = mix(buoy.position, next.position);
  }
  return {
    ...state,
    probe: false,
    applied: new Set(),
    sampled: new Set(),
    trail: [],
    frames: [],
    observations: [],
    evidence: { readings: {}, memory: {}, cues: [] },
    lastTrail: -1,
    plan,
  };
}
