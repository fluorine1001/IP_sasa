/** Closed real intervals with outward IEEE-754 rounding. Invalid/indeterminate
 * arithmetic widens to the whole line; it must never manufacture an empty set. */
export type Interval = { lo: number; hi: number };
export const whole = (): Interval => ({ lo: -Infinity, hi: Infinity });
const bits = new DataView(new ArrayBuffer(8));
export function adjacent(x: number, up: boolean) {
  if (Number.isNaN(x) || x === (up ? Infinity : -Infinity)) return x;
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  bits.setFloat64(0, x);
  bits.setBigUint64(0, bits.getBigUint64(0) + (x > 0 === up ? 1n : -1n));
  return bits.getFloat64(0);
}
export function enclosing(lo: number, hi: number): Interval {
  return Number.isNaN(lo) || Number.isNaN(hi)
    ? whole()
    : { lo: adjacent(lo, false), hi: adjacent(hi, true) };
}
export const point = (n: number): Interval => ({ lo: n, hi: n });
export const intersection = (a: Interval, b: Interval): Interval => ({
  lo: Math.max(a.lo, b.lo),
  hi: Math.min(a.hi, b.hi),
});
export const valid = (a: Interval) => a.lo <= a.hi;
export const plus = (a: Interval, b: Interval) => enclosing(a.lo + b.lo, a.hi + b.hi);
export const minus = (a: Interval, b: Interval) => enclosing(a.lo - b.hi, a.hi - b.lo);
export function times(a: Interval, b: Interval) {
  // 0 times any finite real is exactly zero, even if the domain is unbounded.
  if ((a.lo === 0 && a.hi === 0) || (b.lo === 0 && b.hi === 0)) return point(0);
  const products = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  return enclosing(Math.min(...products), Math.max(...products));
}
export function divided(a: Interval, b: Interval) {
  return b.lo <= 0 && b.hi >= 0 ? whole() : times(a, enclosing(1 / b.hi, 1 / b.lo));
}
export function squared(a: Interval): Interval {
  const min = a.lo <= 0 && a.hi >= 0 ? 0 : Math.min(a.lo * a.lo, a.hi * a.hi);
  return {
    lo: Math.max(0, adjacent(min, false)),
    hi: adjacent(Math.max(a.lo * a.lo, a.hi * a.hi), true),
  };
}
/** Root bounds are checked by directed multiplication, not by an assumed
 * accuracy of Math.sqrt. A platform that fails the check merely loses tightening. */
export function root(a: Interval): Interval {
  if (a.hi < 0) return { lo: 1, hi: 0 };
  let lo = Math.sqrt(Math.max(0, a.lo)),
    hi = Math.sqrt(Math.max(0, a.hi));
  for (let i = 0; i < 8 && lo > 0 && squared(point(lo)).hi > a.lo; i++) lo = adjacent(lo, false);
  for (let i = 0; i < 8 && Number.isFinite(hi) && squared(point(hi)).lo < a.hi; i++)
    hi = adjacent(hi, true);
  if (lo > 0 && squared(point(lo)).hi > a.lo) lo = 0;
  if (Number.isFinite(hi) && squared(point(hi)).lo < a.hi) hi = Infinity;
  return { lo, hi };
}
