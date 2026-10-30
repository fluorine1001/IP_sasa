import type { NonlinearRelation, Term } from './nonlinear-relation';
import type { RealDomain } from './real-domains';
import type { Interval } from '../interval';

type Rational = { n: bigint; d: bigint };
type Polynomial = Rational[];
type Expression = { variable?: string; polynomial: Polynomial };
export type AlgebraicBoundary = { variable: string; coefficients: bigint[] };
export type PolynomialGuard = AlgebraicBoundary & { term: Term; operator: 'lt' | 'lte' };
export type RootCluster = { interval: Interval; count: number };
class PolynomialLimit extends Error {}
const MAX_DEGREE = 12,
  MAX_BITS = 4096;
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
function rational(n: bigint, d = 1n): Rational {
  if (!d) throw new PolynomialLimit();
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  n /= divisor;
  d /= divisor;
  if (n.toString(2).length > MAX_BITS || d.toString(2).length > MAX_BITS)
    throw new PolynomialLimit();
  return { n, d };
}
const plus = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const times = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const negate = (a: Rational) => ({ n: -a.n, d: a.d });
const divide = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n);
const zero = () => rational(0n);
function dyadic(value: number): Rational {
  if (!Number.isFinite(value)) throw new PolynomialLimit();
  if (value === 0) return zero();
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, value);
  const bits = data.getBigUint64(0),
    e = Number((bits >> 52n) & 2047n),
    fraction = bits & ((1n << 52n) - 1n),
    mantissa = (bits >> 63n ? -1n : 1n) * (e ? fraction + (1n << 52n) : fraction),
    exponent = e ? e - 1023 - 52 : -1074;
  return exponent >= 0
    ? rational(mantissa << BigInt(exponent))
    : rational(mantissa, 1n << BigInt(-exponent));
}
function trim(p: Polynomial) {
  while (p.length > 1 && p.at(-1)!.n === 0n) p.pop();
  return p;
}
function add(a: Polynomial, b: Polynomial, sign = 1) {
  return trim(
    Array.from({ length: Math.max(a.length, b.length) }, (_, i) =>
      plus(a[i] ?? zero(), sign === 1 ? (b[i] ?? zero()) : negate(b[i] ?? zero())),
    ),
  );
}
function multiply(a: Polynomial, b: Polynomial) {
  if (a.length + b.length - 2 > MAX_DEGREE) throw new PolynomialLimit();
  const result = Array.from({ length: a.length + b.length - 1 }, zero);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) result[i + j] = plus(result[i + j], times(a[i], b[j]));
  return trim(result);
}
function primitive(p: Polynomial): bigint[] {
  let denominator = 1n;
  for (const v of p) denominator = (denominator / gcd(denominator, v.d)) * v.d;
  const integers = p.map((v) => v.n * (denominator / v.d));
  const divisor = integers.reduce((g, n) => gcd(g, n), 0n);
  if (!divisor) return [0n];
  // A positive scalar only; sign conditions are never inverted here.
  return integers.map((n) => n / divisor);
}
/** Compile only genuinely univariate polynomial guards. Unsupported operations
 * remain in the original nonlinear relation. Shared variables are NOT frozen at
 * sample values. Binary64 constants are exact dyadic rationals in this backend. */
export function polynomialGuards(
  r: NonlinearRelation,
  roots: readonly Term[],
  bounds: Readonly<Record<string, RealDomain>>,
): PolynomialGuard[] {
  const expressions = new Map<number, Expression>(),
    result: PolynomialGuard[] = [];
  const nodes = r.program(roots);
  if (nodes.length > 150_000) return [];
  for (const node of nodes) {
    try {
      const a = expressions.get(node.args[0]?.id),
        b = expressions.get(node.args[1]?.id);
      let expression: Expression | undefined;
      if (node.op === 'literal') expression = { polynomial: [dyadic(node.value!)] };
      else if (node.op === 'input') {
        const d = bounds[node.name!];
        if (d?.length === 1 && d[0].lo === d[0].hi) expression = { polynomial: [dyadic(d[0].lo)] };
        else expression = { variable: node.name!, polynomial: [zero(), rational(1n)] };
      } else if (a && node.op === 'cube')
        expression = {
          variable: a.variable,
          polynomial: multiply(multiply(a.polynomial, a.polynomial), a.polynomial),
        };
      else if (a && b && (!a.variable || !b.variable || a.variable === b.variable)) {
        const variable = a.variable ?? b.variable;
        if (node.op === 'add' || node.op === 'subtract')
          expression = {
            variable,
            polynomial: add(a.polynomial, b.polynomial, node.op === 'add' ? 1 : -1),
          };
        else if (node.op === 'multiply')
          expression = { variable, polynomial: multiply(a.polynomial, b.polynomial) };
        else if (
          node.op === 'divide' &&
          !b.variable &&
          b.polynomial.length === 1 &&
          b.polynomial[0].n !== 0n
        )
          expression = {
            variable,
            polynomial: a.polynomial.map((v) => divide(v, b.polynomial[0])),
          };
        else if ((node.op === 'lt' || node.op === 'lte') && variable) {
          const coefficients = primitive(add(a.polynomial, b.polynomial, -1));
          if (result.length < 64)
            result.push({ variable, coefficients, term: node.term, operator: node.op });
        }
      }
      if (expression) {
        if (expression.polynomial.length === 1) expression.variable = undefined;
        expressions.set(node.term.id, expression);
      }
    } catch (error) {
      if (!(error instanceof PolynomialLimit)) throw error;
    }
  }
  return result;
}
export function polynomialBoundaries(
  r: NonlinearRelation,
  roots: readonly Term[],
  bounds: Readonly<Record<string, RealDomain>>,
): AlgebraicBoundary[] {
  const result = new Map<string, AlgebraicBoundary>();
  for (const { variable, coefficients } of polynomialGuards(r, roots, bounds)) {
    if (coefficients.length < 2) continue;
    result.set(variable + ':' + coefficients.map(String).join(','), { variable, coefficients });
  }
  return [...result.values()];
}
function derivative(p: Polynomial): Polynomial {
  return p.length < 2 ? [zero()] : p.slice(1).map((v, i) => times(v, rational(BigInt(i + 1))));
}
function remainder(a: Polynomial, b: Polynomial): Polynomial {
  const r = a.slice();
  while (r.length >= b.length && r.some((v) => v.n)) {
    const scale = divide(r.at(-1)!, b.at(-1)!),
      offset = r.length - b.length;
    for (let j = 0; j < b.length; j++)
      r[offset + j] = plus(r[offset + j], negate(times(scale, b[j])));
    trim(r);
  }
  return r;
}
function value(p: Polynomial, x: Rational) {
  let v = zero();
  for (let i = p.length - 1; i >= 0; i--) v = plus(times(v, x), p[i]);
  return v;
}
/** Exact Sturm counts, INCLUDING multiple/tangent roots (counted distinctly).
 * Close roots stay together as certified clusters; no approximate zero test.
 * Limits return covering clusters, not a claim that a boundary disappeared. */
export function polynomialRootClusters(
  coefficients: readonly bigint[],
  interval: Interval,
  options: { resolution?: number; work?: number } = {},
): { clusters: RootCluster[]; visits: number } | undefined {
  if (
    !coefficients.length ||
    coefficients.length > MAX_DEGREE + 1 ||
    !Number.isFinite(interval.lo) ||
    !Number.isFinite(interval.hi) ||
    interval.lo > interval.hi ||
    !Number.isSafeInteger(options.work ?? 2048) ||
    (options.work ?? 2048) < 0 ||
    !Number.isFinite(options.resolution ?? 1e-10) ||
    (options.resolution ?? 1e-10) <= 0
  )
    return;
  try {
    let p = trim(coefficients.map((n) => rational(n)));
    // The zero polynomial has infinitely many roots, not an empty root set.
    if (p.length === 1 && p[0].n === 0n) return;
    if (p.length <= 1) return { clusters: [], visits: 0 };
    // Sturm's sequence for p/gcd(p,p') has the same distinct real zeros.
    let a = p,
      b = derivative(p);
    while (b.some((v) => v.n)) {
      const next = remainder(a, b);
      a = b;
      b = next;
    }
    if (a.length > 1) {
      const quotient = Array.from({ length: p.length - a.length + 1 }, zero),
        rem = p.slice();
      while (rem.length >= a.length && rem.some((v) => v.n)) {
        const c = divide(rem.at(-1)!, a.at(-1)!),
          at = rem.length - a.length;
        quotient[at] = c;
        for (let j = 0; j < a.length; j++) rem[at + j] = plus(rem[at + j], negate(times(c, a[j])));
        trim(rem);
      }
      p = trim(quotient);
    }
    const sequence = [p, derivative(p)];
    while (sequence.at(-1)!.length > 1) {
      const rem = remainder(sequence.at(-2)!, sequence.at(-1)!).map(negate);
      if (!rem.some((v) => v.n)) break;
      sequence.push(rem);
    }
    const cache = new Map<number, { left: number; right: number; root: boolean }>();
    const variation = (at: number) => {
      const previous = cache.get(at);
      if (previous) return previous;
      const x = dyadic(at),
        left: number[] = [],
        right: number[] = [];
      for (const entry of sequence) {
        let q = entry,
          v = value(q, x),
          order = 0;
        while (v.n === 0n && q.length > 1) {
          q = derivative(q);
          v = value(q, x);
          order++;
        }
        const sign = v.n > 0n ? 1 : v.n < 0n ? -1 : 0;
        if (sign) {
          right.push(sign);
          left.push(order % 2 ? -sign : sign);
        }
      }
      const changes = (signs: number[]) =>
        signs.slice(1).reduce((n, s, i) => n + Number(s !== signs[i]), 0);
      const result = { left: changes(left), right: changes(right), root: value(p, x).n === 0n };
      cache.set(at, result);
      return result;
    };
    const clusters: RootCluster[] = [],
      queue: { lo: number; hi: number; count: number }[] = [];
    const start = variation(interval.lo),
      end = variation(interval.hi);
    if (start.root) clusters.push({ interval: { lo: interval.lo, hi: interval.lo }, count: 1 });
    if (end.root && interval.lo !== interval.hi)
      clusters.push({ interval: { lo: interval.hi, hi: interval.hi }, count: 1 });
    const total = start.right - end.left;
    if (total > 0) queue.push({ ...interval, count: total });
    let visits = 0;
    const limit = options.work ?? 2048,
      resolution = options.resolution ?? 1e-10;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor],
        mid = current.lo / 2 + current.hi / 2;
      if (
        ++visits > limit ||
        !(current.lo < mid && mid < current.hi) ||
        current.hi - current.lo <=
          resolution * Math.max(1, Math.abs(current.lo), Math.abs(current.hi))
      ) {
        clusters.push({ interval: { lo: current.lo, hi: current.hi }, count: current.count });
        continue;
      }
      const center = variation(mid),
        lower = variation(current.lo),
        upper = variation(current.hi);
      if (center.root) clusters.push({ interval: { lo: mid, hi: mid }, count: 1 });
      const left = lower.right - center.left,
        right = center.right - upper.left;
      if (left > 0) queue.push({ lo: current.lo, hi: mid, count: left });
      if (right > 0) queue.push({ lo: mid, hi: current.hi, count: right });
    }
    return { clusters: clusters.sort((a, b) => a.interval.lo - b.interval.lo), visits };
  } catch (error) {
    if (!(error instanceof PolynomialLimit)) throw error;
  }
}

/** A sign query over a real INTERVAL, not a simulated control point. Complete
 * Sturm covering proves that signs cannot change off the retained root strips.
 * Exact point roots can be included (also tangent/equality-only boundaries).
 * An unresolved strip is never interpreted as a single approximate root. */
export function polynomialGuardTruth(
  guard: Pick<PolynomialGuard, 'coefficients' | 'operator'>,
  roots: readonly RootCluster[],
  domain: Interval,
): 0 | 1 | undefined {
  if (!Number.isFinite(domain.lo) || !Number.isFinite(domain.hi) || domain.lo > domain.hi) return;
  try {
    const p = trim(guard.coefficients.map((n) => rational(n)));
    if (!p.length) return;
    const sign = (at: number) => {
      const n = value(p, dyadic(at)).n;
      return n < 0n ? -1 : n > 0n ? 1 : 0;
    };
    if (p.length === 1 || domain.lo === domain.hi) {
      const s = sign(domain.lo);
      return Number(guard.operator === 'lt' ? s < 0 : s <= 0) as 0 | 1;
    }
    const points = [domain.lo, domain.hi];
    for (const { interval: d } of roots) {
      if (d.lo > domain.hi || d.hi < domain.lo) continue;
      if (d.lo !== d.hi) return;
      points.push(d.lo);
    }
    points.sort((a, b) => a - b);
    const signs = points.map(sign);
    for (let i = 1; i < points.length; i++) {
      const mid = points[i - 1] / 2 + points[i] / 2;
      if (points[i - 1] < mid && mid < points[i]) signs.push(sign(mid));
      // Adjacent floats still enclose real points. If the midpoint rounds to
      // an endpoint, a nonzero endpoint fixes the sign on this root-free gap.
      else if (points[i - 1] !== points[i] && signs[i - 1] === 0 && signs[i] === 0) return;
    }
    const truths = signs.map((s) => (guard.operator === 'lt' ? s < 0 : s <= 0));
    if (truths.every(Boolean)) return 1;
    if (truths.every((v) => !v)) return 0;
  } catch (error) {
    if (!(error instanceof PolynomialLimit)) throw error;
  }
}
