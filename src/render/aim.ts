import { length, scale, sub, type Vec } from '../physics/vector.ts';
/** World-space arrow length per unit of launch velocity / correction Δv. */
export const AIM_VECTOR_SCALE = 2.5;
export function aimEndpoint(origin: Vec, vector: Vec): Vec {
  return { x: origin.x + vector.x * AIM_VECTOR_SCALE, y: origin.y + vector.y * AIM_VECTOR_SCALE };
}
export function aimVector(pointer: Vec, grab: Vec, initial: Vec, limit: number): Vec {
  const delta = scale(sub(pointer, grab), 1 / AIM_VECTOR_SCALE),
    v = { x: initial.x + delta.x, y: initial.y + delta.y },
    m = length(v);
  return m > limit ? scale(v, limit / m) : v;
}
