import * as I from '../interval';
const p = I.point;
function atanSmall(x: I.Interval) {
  const square = I.squared(x);
  let power = x,
    sum = p(0);
  for (let n = 0; n < 32; n++) {
    const term = I.divided(power, p(2 * n + 1));
    sum = n % 2 ? I.minus(sum, term) : I.plus(sum, term);
    power = I.times(power, square);
  }
  const tail = I.divided(power, p(65)).hi;
  return I.plus(sum, { lo: -Math.abs(tail), hi: Math.abs(tail) });
}
// Machin's identity encloses mathematical pi; Math.PI is only a convenient
// integer range-reduction hint, not the proof of the transcendental bound.
const pi = I.minus(
  I.times(p(16), atanSmall(I.divided(p(1), p(5)))),
  I.times(p(4), atanSmall(I.divided(p(1), p(239)))),
);
function pointRange(x: number, op: 'sin' | 'cos'): I.Interval {
  if (x === 0) return p(op === 'sin' ? 0 : 1);
  const turns = Math.round(x / (2 * Math.PI)),
    reduced = I.minus(p(x), I.times(p(2 * turns), pi)),
    square = I.squared(reduced);
  let term = op === 'sin' ? reduced : p(1),
    sum = term;
  for (let n = 1; n <= 15; n++) {
    const denominator = op === 'sin' ? 2 * n * (2 * n + 1) : (2 * n - 1) * 2 * n;
    term = I.divided(I.times(term, square), p(denominator));
    sum = n % 2 ? I.minus(sum, term) : I.plus(sum, term);
  }
  // Taylor's Lagrange remainder; every derivative is bounded by one.
  const radius = Math.max(Math.abs(reduced.lo), Math.abs(reduced.hi));
  let remainder = p(1);
  const degree = op === 'sin' ? 32 : 31;
  for (let n = 1; n <= degree; n++) remainder = I.divided(I.times(remainder, p(radius)), p(n));
  return I.plus(sum, { lo: -remainder.hi, hi: remainder.hi });
}

/** Certified range, with explicit extremum inclusion. Partial operations and
 * enormous arguments lose tightening instead of assuming Math.sin's accuracy. */
export function trigRange(d: I.Interval, op: 'sin' | 'cos'): I.Interval {
  if (
    !Number.isFinite(d.lo) ||
    !Number.isFinite(d.hi) ||
    !I.valid(d) ||
    Math.max(Math.abs(d.lo), Math.abs(d.hi)) > 1e6 ||
    d.hi - d.lo >= 2 * pi.lo
  )
    return { lo: -1, hi: 1 };
  const a = pointRange(d.lo, op),
    b = pointRange(d.hi, op);
  let lo = Math.min(a.lo, b.lo),
    hi = Math.max(a.hi, b.hi);
  const shift = op === 'sin' ? 0.5 : 0;
  for (
    let n = Math.floor(d.lo / Math.PI - shift) - 2;
    n <= Math.ceil(d.hi / Math.PI - shift) + 2;
    n++
  ) {
    const at = I.times(p(n + shift), pi);
    if (at.lo > d.hi || at.hi < d.lo) continue;
    if (n % 2 === 0) hi = 1;
    else lo = -1;
  }
  return { lo: Math.max(-1, lo), hi: Math.min(1, hi) };
}
