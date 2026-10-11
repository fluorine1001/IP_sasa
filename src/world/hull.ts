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
type Hull = ReturnType<typeof hullSize>;
const direction = (v: Vec) => (length(v) > 1e-9 ? unit(v) : { x: 1, y: 0 });
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
): number | undefined {
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
