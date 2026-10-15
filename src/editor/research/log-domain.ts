import * as I from '../interval';
import { normalize, type RealDomain } from './real-domains';

/** Certified real logarithm, not an assumed one-ulp Math.log error bound.
 * log(m)=2*atanh((m-1)/(m+1)), 1<=m<=2; 48 terms plus a geometric tail.
 * All arithmetic and ln(2) use outward intervals. */
function mantissaLog(m: number): I.Interval {
  const z0 = I.divided(I.minus(I.point(m), I.point(1)), I.plus(I.point(m), I.point(1)));
  const z = { lo: Math.max(0, z0.lo), hi: Math.max(0, z0.hi) },
    square = I.times(z, z);
  let power = z,
    sum = I.point(0);
  for (let k = 0; k < 48; k++) {
    sum = I.plus(sum, I.divided(power, I.point(2 * k + 1)));
    power = I.times(power, square);
  }
  const tail = I.divided(
    I.times(I.point(2), power),
    I.times(I.point(97), I.minus(I.point(1), square)),
  );
  const result = I.times(I.point(2), sum);
  return { lo: Math.max(0, result.lo), hi: I.plus(result, { lo: 0, hi: tail.hi }).hi };
}
const ln2 = mantissaLog(2);
export function logPoint(x: number): I.Interval {
  const previous = logarithms.get(x);
  if (previous) return previous;
  const value = calculateLogPoint(x);
  if (logarithms.size >= 4096) logarithms.delete(logarithms.keys().next().value!);
  logarithms.set(x, Object.freeze(value));
  return value;
}
const logarithms = new Map<number, I.Interval>();
function calculateLogPoint(x: number): I.Interval {
  if (x === 1) return I.point(0);
  if (x <= 0) return I.point(-Infinity);
  if (x === Infinity) return I.point(Infinity);
  let exponent = Math.max(-1022, Math.min(1023, Math.floor(Math.log2(x))));
  let m = x / 2 ** exponent;
  while (m < 1) {
    m *= 2;
    exponent--;
  }
  while (m > 2) {
    m /= 2;
    exponent++;
  }
  return I.plus(mantissaLog(m), I.times(I.point(exponent), ln2));
}
export const logDomains = (domains: RealDomain) =>
  normalize(
    domains
      .filter((d) => d.hi > 0)
      .map((d) => ({ lo: d.lo <= 0 ? -Infinity : logPoint(d.lo).lo, hi: logPoint(d.hi).hi })),
  );
/** Exponential candidates are checked by real log enclosures before use. If
 * the enclosure cannot prove a bound, widen instead of cutting feasible values. */
export function expDomains(domains: RealDomain): RealDomain {
  return normalize(
    domains.map((d) => {
      let lo = Math.exp(d.lo),
        hi = Math.exp(d.hi);
      for (let i = 0; i < 8 && lo > 0 && logPoint(lo).hi > d.lo; i++)
        lo = I.adjacent(lo / (1 + Math.max(Number.EPSILON, 2 * (logPoint(lo).hi - d.lo))), false);
      for (let i = 0; i < 8 && Number.isFinite(hi) && logPoint(hi).lo < d.hi; i++)
        hi = I.adjacent(hi * (1 + Math.max(Number.EPSILON, 2 * (d.hi - logPoint(hi).lo))), true);
      if (lo > 0 && logPoint(lo).hi > d.lo) lo = 0;
      if (Number.isFinite(hi) && logPoint(hi).lo < d.hi) hi = Infinity;
      return { lo, hi };
    }),
  );
}
