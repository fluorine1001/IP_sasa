import { floatAlgebra, type RealAlgebra, type VectorOf } from './nonlinear-kernel';

/** Boolean values are 0/1 terms, not independent mode-choice variables. Each
 * guard is computed from its physical operands. select keeps both alternatives
 * in a compiled relation. Kernels totalise unused divisions/roots explicitly. */
export interface HybridAlgebra<T> extends RealAlgebra<T> {
  constantValue?(value: T): number | undefined;
  subtract(a: T, b: T): T;
  min(a: T, b: T): T;
  sqrt(a: T): T;
  log(a: T): T;
  lt(a: T, b: T): T;
  lte(a: T, b: T): T;
  select(condition: T, yes: T, no: T): T;
}
export const hybridFloat: HybridAlgebra<number> = {
  ...floatAlgebra,
  constantValue: (value) => value,
  subtract: (a, b) => a - b,
  min: Math.min,
  sqrt: Math.sqrt,
  log: Math.log,
  lt: (a, b) => Number(a < b),
  lte: (a, b) => Number(a <= b),
  select: (condition, yes, no) => (condition ? yes : no),
};
export const logic = <T>(a: HybridAlgebra<T>) => ({
  and: (x: T, y: T) => a.select(x, y, a.literal(0)),
  or: (x: T, y: T) => a.select(x, a.literal(1), y),
  not: (x: T) => a.select(x, a.literal(0), a.literal(1)),
  eq: (x: T, y: T) => a.select(a.lte(x, y), a.lte(y, x), a.literal(0)),
});

export function burn<T>(
  a: HybridAlgebra<T>,
  c: {
    mass: T;
    fuel: T;
    throttle: T;
    thrust: T;
    exhaustSpeed: T;
    dt: T;
  },
) {
  const spent = a.min(
    c.fuel,
    a.divide(a.multiply(a.multiply(c.thrust, c.throttle), c.dt), c.exhaustSpeed),
  );
  const remainingMass = a.subtract(c.mass, spent),
    positive = a.lt(a.literal(0), spent);
  // log's inactive operand is 1. No log(0), infinity, or fictitious burn branch.
  const ratio = a.divide(c.mass, a.select(positive, remainingMass, c.mass));
  const delta = a.select(positive, a.multiply(c.exhaustSpeed, a.log(ratio)), a.literal(0));
  const fuel = a.subtract(c.fuel, spent);
  return { fuel, delta, throttle: a.select(a.lt(fuel, a.literal(1e-9)), a.literal(0), c.throttle) };
}

/** Finite ignition resources: rejected re-ignition preserves the old state. */
export function engineSetting<T>(
  a: HybridAlgebra<T>,
  fuel: T,
  old: T,
  ignitions: T,
  limit: T,
  requested: T,
) {
  const { and, or, not, eq } = logic(a),
    zero = a.literal(0),
    one = a.literal(1);
  const value = a.max(zero, a.min(one, requested));
  const restart = and(a.lt(zero, value), eq(old, zero));
  const permitted = and(a.lt(zero, fuel), a.lt(ignitions, limit));
  const accepted = or(not(restart), permitted);
  return {
    accepted,
    throttle: a.select(accepted, a.select(a.lt(zero, fuel), value, zero), old),
    ignitions: a.select(and(accepted, restart), a.add(ignitions, one), ignitions),
  };
}

export function separationReset<T>(
  a: HybridAlgebra<T>,
  position: VectorOf<T>,
  velocity: VectorOf<T>,
  direction: VectorOf<T>,
  total: T,
  detached: T,
  extent: T,
) {
  const upper = a.max(a.literal(1e-9), a.subtract(total, detached));
  const lowerKick = a.divide(a.multiply(a.literal(0.025), upper), total);
  const upperKick = a.divide(a.multiply(a.literal(0.025), detached), total);
  const detachedVelocity = {
    x: a.add(velocity.x, a.multiply(a.multiply(direction.x, lowerKick), a.literal(-1))),
    y: a.add(velocity.y, a.multiply(a.multiply(direction.y, lowerKick), a.literal(-1))),
  };
  return {
    position: {
      x: a.add(position.x, a.multiply(direction.x, extent)),
      y: a.add(position.y, a.multiply(direction.y, extent)),
    },
    velocity: {
      x: a.add(velocity.x, a.multiply(direction.x, upperKick)),
      y: a.add(velocity.y, a.multiply(direction.y, upperKick)),
    },
    detachedVelocity,
  };
}

/** Preserve engine precedence: successful safe landing may complete a goal;
 * an unsafe body impact precedes an object hazard, and both precede timeout.
 * The expired guard also covers non-finite/out-of-world actual engine state. */
export function flightOutcome<T>(
  a: HybridAlgebra<T>,
  c: {
    goals: T;
    collision: T;
    landed: T;
    hazard: T;
    expired: T;
    probe: T;
  },
) {
  const { and, or, not } = logic(a);
  const safe = and(not(c.hazard), or(not(c.collision), c.landed));
  const won = and(and(c.goals, safe), not(c.probe));
  const impact = and(not(won), and(c.collision, not(c.landed)));
  const remaining = and(not(won), not(impact));
  const hazard = and(remaining, c.hazard);
  const timeout = and(and(remaining, not(c.hazard)), c.expired);
  return {
    won,
    impact,
    hazard,
    failed: or(hazard, and(timeout, not(c.probe))),
    observed: and(timeout, c.probe),
  };
}

/** All candidate surfaces of the game's swept capsule, including initially
 * overlapping, stationary, grazing, side and endpoint contacts. time is meaningful
 * only when hit=1. No flight samples or mode-path enumeration are used. */
export function capsuleSweep<T>(
  a: HybridAlgebra<T>,
  c: {
    before: VectorOf<T>;
    after: VectorOf<T>;
    heading: VectorOf<T>;
    centerBefore: VectorOf<T>;
    centerAfter: VectorOf<T>;
    length: T;
    hullRadius: T;
    radius: T;
  },
) {
  const zero = a.literal(0),
    one = a.literal(1),
    minus = a.literal(-1),
    { and, or, not } = logic(a);
  const sub = (x: VectorOf<T>, y: VectorOf<T>) => ({
    x: a.add(x.x, a.multiply(y.x, minus)),
    y: a.add(x.y, a.multiply(y.y, minus)),
  });
  const dot = (x: VectorOf<T>, y: VectorOf<T>) => a.add(a.multiply(x.x, y.x), a.multiply(x.y, y.y));
  const norm = (v: VectorOf<T>) => a.hypot(v.x, v.y);
  const relative = sub(c.before, c.centerBefore),
    delta = sub(sub(c.after, c.centerAfter), relative);
  const broad = a.lte(norm(relative), a.add(a.add(c.radius, c.length), norm(delta)));
  const h = norm(c.heading),
    usable = a.lt(a.literal(1e-9), h),
    scale = a.divide(one, a.select(usable, h, one));
  const axis = {
    x: a.select(usable, a.multiply(c.heading.x, scale), one),
    y: a.select(usable, a.multiply(c.heading.y, scale), zero),
  };
  const side = { x: a.multiply(axis.y, minus), y: axis.x };
  const origin = {
    x: a.add(relative.x, a.multiply(axis.x, c.hullRadius)),
    y: a.add(relative.y, a.multiply(axis.y, c.hullRadius)),
  };
  const p = { x: a.multiply(dot(origin, axis), minus), y: a.multiply(dot(origin, side), minus) };
  const v = { x: a.multiply(dot(delta, axis), minus), y: a.multiply(dot(delta, side), minus) };
  const extent = a.max(zero, a.subtract(c.length, a.multiply(a.literal(2), c.hullRadius))),
    radius = a.add(c.radius, c.hullRadius);
  const overlap = a.lte(a.hypot(a.subtract(p.x, a.max(zero, a.min(extent, p.x))), p.y), radius);
  let hit = zero,
    time = one;
  const accept = (t: T, valid: T) => {
    const inRange = and(and(valid, a.lte(zero, t)), a.lte(t, one));
    time = a.select(inRange, a.select(hit, a.min(time, t), t), time);
    hit = or(hit, inRange);
  };
  for (const x of [zero, extent]) {
    const dx = a.subtract(p.x, x),
      qa = dot(v, v);
    const qb = a.multiply(a.literal(2), a.add(a.multiply(dx, v.x), a.multiply(p.y, v.y)));
    const qc = a.subtract(
      a.add(a.multiply(dx, dx), a.multiply(p.y, p.y)),
      a.multiply(radius, radius),
    );
    const disc = a.subtract(a.multiply(qb, qb), a.multiply(a.multiply(a.literal(4), qa), qc));
    const valid = and(a.lt(a.literal(1e-20), qa), a.lte(zero, disc));
    const t = a.divide(
      a.subtract(a.multiply(qb, minus), a.sqrt(a.max(zero, disc))),
      a.multiply(a.literal(2), a.select(valid, qa, one)),
    );
    accept(t, valid);
  }
  const moving = a.lt(a.literal(1e-12), a.max(v.y, a.multiply(v.y, minus)));
  for (const y of [a.multiply(radius, minus), radius]) {
    const t = a.divide(a.subtract(y, p.y), a.select(moving, v.y, one)),
      x = a.add(p.x, a.multiply(t, v.x));
    accept(t, and(moving, and(a.lte(zero, x), a.lte(x, extent))));
  }
  return {
    hit: and(broad, or(overlap, hit)),
    time: a.select(overlap, zero, time),
    miss: or(not(broad), not(or(overlap, hit))),
  };
}
