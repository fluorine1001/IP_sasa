/* A held launch's moment: the craft sits on the pad (bodies move on rails), so the
 * window is found by stepping the pad's reading until the set angle is crossed — the
 * same test the engine applies (heading.ts triggerFired). */
import { triggerFired, triggerReading, type TriggerReading } from './heading';
import { surfaceLaunch } from './launch';
import { add, sub } from '../physics/vector';
import type { RoutePlan, Stage } from './types';

/** When a held launch leaves the pad (undefined when not held or never within `until`). */
export function launchWindowTime(stage: Stage, plan: RoutePlan, until = 400): number | undefined {
  const hold = plan.launchHold;
  if (!hold || !surfaceLaunch(stage)) return undefined;
  const spec = { at: hold.at, atAngle: hold.atAngle, phaseTarget: hold.phaseTarget };
  let last: TriggerReading | undefined;
  for (let t = 0; t <= until; t += 0.01) {
    const pad = surfaceLaunch(stage, t)!;
    const now = triggerReading(stage, pad.position, pad.velocity, t, hold.phaseTarget);
    if (triggerFired(spec, last, now)) return t;
    last = now;
  }
  return undefined;
}

/** The state right after a held launch: the pad at its window plus the launch push. */
export function heldLaunchState(stage: Stage, plan: RoutePlan, start: { x: number; y: number }) {
  const t = launchWindowTime(stage, plan);
  if (t === undefined) return undefined;
  const pad0 = surfaceLaunch(stage, 0)!,
    pad = surfaceLaunch(stage, t)!;
  return {
    position: add(pad.position, sub(start, pad0.position)),
    velocity: add(pad.velocity, plan.launch),
    time: t,
  };
}
