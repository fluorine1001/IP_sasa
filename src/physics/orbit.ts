import { add, scale, length, sub, dot, type Vec } from './vector.ts';
export type BodyState = { position: Vec; velocity: Vec };
export function acceleration(position: Vec, mu: number): Vec {
  const r = Math.max(length(position), 1e-8);
  return scale(position, -mu / (r * r * r));
}
export function integrate(state: BodyState, dt: number, mu: number): BodyState {
  const derivative = (s: BodyState): BodyState => ({
    position: s.velocity,
    velocity: acceleration(s.position, mu),
  });
  const offset = (d: BodyState, k: number): BodyState => ({
    position: add(state.position, scale(d.position, k)),
    velocity: add(state.velocity, scale(d.velocity, k)),
  });
  const a = derivative(state),
    b = derivative(offset(a, dt / 2)),
    c = derivative(offset(b, dt / 2)),
    d = derivative(offset(c, dt));
  const sum = (key: keyof BodyState): Vec =>
    scale(add(add(a[key], scale(b[key], 2)), add(scale(c[key], 2), d[key])), dt / 6);
  return {
    position: add(state.position, sum('position')),
    velocity: add(state.velocity, sum('velocity')),
  };
}
export function energy(state: BodyState, mu: number): number {
  return dot(state.velocity, state.velocity) / 2 - mu / length(state.position);
}
export function angularMomentum(state: BodyState): number {
  return state.position.x * state.velocity.y - state.position.y * state.velocity.x;
}
export function segmentHitsCircle(a: Vec, b: Vec, radius: number): boolean {
  const ab = sub(b, a),
    t = Math.max(0, Math.min(1, -dot(a, ab) / (dot(ab, ab) || 1)));
  return length(add(a, scale(ab, t))) <= radius;
}
export function circularState(radius: number, mu: number, angle = 0): BodyState {
  return {
    position: { x: radius * Math.cos(angle), y: radius * Math.sin(angle) },
    velocity: {
      x: -Math.sqrt(mu / radius) * Math.sin(angle),
      y: Math.sqrt(mu / radius) * Math.cos(angle),
    },
  };
}
export function inferGravity(r0: number, v0: number, r1: number, v1: number): number | null {
  const denominator = 2 * (1 / r0 - 1 / r1);
  if (Math.abs(denominator) < 1e-5) return null;
  const mu = (v0 * v0 - v1 * v1) / denominator;
  return Number.isFinite(mu) && mu > 0 ? mu : null;
}
