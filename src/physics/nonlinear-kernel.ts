/** One arithmetic program for point execution and nonlinear relation compilation.
 * Operation order is intentional: do not reassociate sums/products or replace
 * hypot/cube by algebraically equivalent float expressions. */
export interface RealAlgebra<T> {
  literal(value: number): T;
  add(a: T, b: T): T;
  multiply(a: T, b: T): T;
  divide(a: T, b: T): T;
  cube(a: T): T;
  hypot(a: T, b: T): T;
  max(a: T, b: T): T;
}
export type VectorOf<T> = { x: T; y: T };
export const floatAlgebra: RealAlgebra<number> = {
  literal: (value) => value,
  add: (a, b) => a + b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b,
  cube: (a) => a ** 3,
  hypot: (a, b) => Math.hypot(a, b),
  max: (a, b) => Math.max(a, b),
};

export function attraction<T>(
  algebra: RealAlgebra<T>,
  position: VectorOf<T>,
  center: VectorOf<T>,
  mu: T,
  softRadius: T,
): VectorOf<T> {
  const minusOne = algebra.literal(-1);
  const x = algebra.add(center.x, algebra.multiply(position.x, minusOne));
  const y = algebra.add(center.y, algebra.multiply(position.y, minusOne));
  const r = algebra.max(algebra.hypot(x, y), softRadius);
  const factor = algebra.divide(mu, algebra.cube(r));
  return { x: algebra.multiply(x, factor), y: algebra.multiply(y, factor) };
}

export function rk4<T>(
  algebra: RealAlgebra<T>,
  acceleration: (position: VectorOf<T>, velocity: VectorOf<T>, time: T) => VectorOf<T>,
  p: VectorOf<T>,
  v: VectorOf<T>,
  t: T,
  dt: T,
): [VectorOf<T>, VectorOf<T>] {
  const plus = (a: VectorOf<T>, b: VectorOf<T>): VectorOf<T> => ({
    x: algebra.add(a.x, b.x),
    y: algebra.add(a.y, b.y),
  });
  const scale = (a: VectorOf<T>, k: T): VectorOf<T> => ({
    x: algebra.multiply(a.x, k),
    y: algebra.multiply(a.y, k),
  });
  const two = algebra.literal(2),
    half = algebra.divide(dt, two),
    middle = algebra.add(t, half);
  const a = acceleration(p, v, t),
    vb = plus(v, scale(a, half)),
    pb = plus(p, scale(v, half));
  const b = acceleration(pb, vb, middle),
    vc = plus(v, scale(b, half)),
    pc = plus(p, scale(vb, half));
  const c = acceleration(pc, vc, middle),
    vd = plus(v, scale(c, dt)),
    pd = plus(p, scale(vc, dt));
  const d = acceleration(pd, vd, algebra.add(t, dt)),
    sixth = algebra.divide(dt, algebra.literal(6));
  return [
    plus(p, scale(plus(plus(v, scale(vb, two)), plus(scale(vc, two), vd)), sixth)),
    plus(v, scale(plus(plus(a, scale(b, two)), plus(scale(c, two), d)), sixth)),
  ];
}
