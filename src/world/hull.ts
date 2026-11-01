import { add, sub, scale, length, dot, unit, type Vec } from '../physics/vector';
import type { Run, Stage } from './types';
/** A world-space capsule shared by rendering and collision. Position is the base. */
export const ROCKET_SEGMENT_LENGTH = 0.12;
export const ROCKET_PAYLOAD_LENGTH = 0.1;
export const ROCKET_RADIUS = 0.035;
export function hullSize(count = 1, booster = false) {
  return {
    length: booster
      ? ROCKET_SEGMENT_LENGTH
      : ROCKET_PAYLOAD_LENGTH + Math.max(0, count) * ROCKET_SEGMENT_LENGTH,
    radius: ROCKET_RADIUS,
  };
}
export function craftHull(stage: Stage, run?: Run) {
  return hullSize(
    stage.rocket ? Math.max(0, stage.rocket.parts.length - (run?.rocket?.partIndex ?? 0)) : 1,
  );
}
export type Hull = ReturnType<typeof hullSize>;
const direction = (v: Vec) => (length(v) > 1e-9 ? unit(v) : { x: 1, y: 0 });
export function hullPoseAt(
  before: Vec,
  after: Vec,
  initial: Vec,
  final: Vec,
  hull: Hull,
  t: number,
) {
  const a = Math.atan2(initial.y, initial.x),
    b = Math.atan2(final.y, final.x);
  const angle = a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
  const heading = { x: Math.cos(angle), y: Math.sin(angle) };
  const c0 = add(before, scale(direction(initial), hull.length / 2));
  const c1 = add(after, scale(direction(final), hull.length / 2));
  return {
    heading,
    position: sub(add(c0, scale(sub(c1, c0), t)), scale(heading, hull.length / 2)),
  };
}
function closest(base: Vec, axis: Vec, hull: Hull): Vec {
  const a = add(base, scale(axis, hull.radius));
  const extent = Math.max(0, hull.length - 2 * hull.radius);
  return add(a, scale(axis, Math.max(0, Math.min(extent, -dot(a, axis)))));
}
export function hullGap(base: Vec, heading: Vec, hull: Hull, center: Vec, radius: number) {
  return length(closest(sub(base, center), direction(heading), hull)) - hull.radius - radius;
}
export function sweepHull(
  before: Vec,
  after: Vec,
  heading: Vec,
  hull: Hull,
  centerBefore: Vec,
  centerAfter: Vec,
  radius: number,
  previousHeading?: Vec,
): number | undefined {
  if (previousHeading) {
    const angle = Math.atan2(previousHeading.y, previousHeading.x);
    const turn = Math.atan2(
      Math.sin(Math.atan2(heading.y, heading.x) - angle),
      Math.cos(Math.atan2(heading.y, heading.x) - angle),
    );
    if (Math.abs(turn) > 1e-10) {
      // Sweep the same centre pivot used by poweredStep and the renderer.
      // Distance to a capsule is Lipschitz: translation + angular speed * radius
      // bounds how quickly a positive gap can close (conservative advancement).
      const midpoint0 = add(before, scale(direction(previousHeading), hull.length / 2));
      const midpoint1 = add(after, scale(direction(heading), hull.length / 2));
      const velocity = sub(sub(midpoint1, midpoint0), sub(centerAfter, centerBefore));
      const bound = length(velocity) + (Math.abs(turn) * hull.length) / 2;
      if (length(sub(midpoint0, centerBefore)) > radius + hull.length / 2 + length(velocity))
        return;
      const tolerance = 1e-9 * Math.max(1, radius, hull.length);
      const search = (start: number, end: number, depth: number): number | undefined => {
        let t = start;
        for (let i = 0; i < 256 && t <= end; i++) {
          const axis = { x: Math.cos(angle + turn * t), y: Math.sin(angle + turn * t) };
          const base = sub(
            add(midpoint0, scale(sub(midpoint1, midpoint0), t)),
            scale(axis, hull.length / 2),
          );
          const center = add(centerBefore, scale(sub(centerAfter, centerBefore), t));
          const gap = hullGap(base, axis, hull, center, radius);
          if (gap <= tolerance) return t;
          if (bound <= 1e-15 || gap > bound * (end - t) + tolerance) return;
          t += Math.max(gap / bound, 1e-12);
        }
        if (t > end) return;
        // Unresolved grazing contact: search the remaining interval in order.
        // At the depth cap conservatively report contact, rather than tunnelling.
        if (depth >= 12) return t;
        const middle = (t + end) / 2;
        if (middle <= t || middle >= end) return t;
        return search(t, middle, depth + 1) ?? search(middle, end, depth + 1);
      };
      return search(0, 1, 0);
    }
  }
  const relativeBefore = sub(before, centerBefore),
    relativeAfter = sub(after, centerAfter);
  const delta = sub(relativeAfter, relativeBefore);
  // Conservative broad phase: the full hull fits inside a length-radius sphere at its base.
  if (length(relativeBefore) > radius + hull.length + length(delta)) return undefined;
  const axis = direction(heading),
    side = { x: -axis.y, y: axis.x };
  const origin = add(relativeBefore, scale(axis, hull.radius));
  const movement = delta;
  const p = { x: -dot(origin, axis), y: -dot(origin, side) };
  const v = { x: -dot(movement, axis), y: -dot(movement, side) };
  const extent = Math.max(0, hull.length - 2 * hull.radius),
    r = radius + hull.radius;
  if (Math.hypot(p.x - Math.max(0, Math.min(extent, p.x)), p.y) <= r) return 0;
  const candidates: number[] = [];
  for (const x of [0, extent]) {
    const dx = p.x - x,
      a = dot(v, v),
      b = 2 * (dx * v.x + p.y * v.y),
      c = dx * dx + p.y * p.y - r * r;
    const disc = b * b - 4 * a * c;
    if (a > 1e-20 && disc >= 0) candidates.push((-b - Math.sqrt(disc)) / (2 * a));
  }
  if (Math.abs(v.y) > 1e-12)
    for (const y of [-r, r]) {
      const t = (y - p.y) / v.y,
        x = p.x + t * v.x;
      if (x >= 0 && x <= extent) candidates.push(t);
    }
  const valid = candidates.filter((t) => t >= 0 && t <= 1);
  return valid.length ? Math.min(...valid) : undefined;
}
/** Resolve the complete hull, including while impact attitude changes. */
export function settleHull(
  base: Vec,
  heading: Vec,
  hull: Hull,
  center: Vec,
  radius: number,
  clearance = 0.005,
): Vec {
  let result = { ...base };
  const axis = direction(heading);
  for (let i = 0; i < 12; i++) {
    const contact = closest(sub(result, center), axis, hull),
      gap = length(contact) - hull.radius - radius;
    if (gap >= clearance - 1e-10) break;
    const normal = length(contact) > 1e-9 ? unit(contact) : unit(sub(result, center));
    result = add(result, scale(length(normal) ? normal : { x: 1, y: 0 }, clearance - gap));
  }
  return result;
}
