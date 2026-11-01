import * as I from '../interval';
import { logDomains } from './log-domain';
import type { Term } from './nonlinear-relation';
import type { RealDomain } from './real-domains';

type Model = { coefficients: Map<number, I.Interval>; error: I.Interval };
type Binary = 'add' | 'subtract' | 'multiply' | 'divide' | 'hypot' | 'min' | 'max';
type Unary = 'cube' | 'sqrt' | 'log';
const zero = () => I.point(0);
const isZero = (v: I.Interval) => v.lo === 0 && v.hi === 0;
const finite = (v: I.Interval) => Number.isFinite(v.lo) && Number.isFinite(v.hi) && I.valid(v);
const plus = (a: I.Interval, b: I.Interval) => (isZero(a) ? b : isZero(b) ? a : I.plus(a, b));

/** Second-order, dependency-preserving Taylor models on one assumption box.
 * x_i = center_i + radius_i * e_i, |e_i| <= 1. Coefficients and truncation
 * errors use outward intervals; no fitted trajectories or floating error guess.
 * A bounded arena drops tightening, NEVER drops a control or changes a DAG.
 * This is a low-order validated model, not a general analytic inverse theorem. */
export class TaylorEnclosure {
  private models = new Map<number, Model>();
  private variables: string[];
  private powers: number[][] = [];
  private products: number[][] = [];
  private ranges: I.Interval[] = [];
  private used = 0;
  private operations = 0;
  constructor(
    private assumptions: Readonly<Record<string, RealDomain>>,
    private interval: (t: Term) => I.Interval,
    private capacity = 100_000,
  ) {
    this.variables = Object.keys(assumptions).filter((key) => {
      const d = assumptions[key];
      return d.length && d[0].lo !== d.at(-1)!.hi;
    });
    // Avoid a hidden O(k²) arena for an arbitrarily wide control interface.
    if (this.variables.length > 8) return;
    const k = this.variables.length;
    this.powers.push(Array(k).fill(0));
    for (let i = 0; i < k; i++) {
      const p = Array(k).fill(0);
      p[i] = 1;
      this.powers.push(p);
    }
    for (let i = 0; i < k; i++)
      for (let j = i; j < k; j++) {
        const p = Array(k).fill(0);
        p[i]++;
        p[j]++;
        this.powers.push(p);
      }
    const indexes = new Map(this.powers.map((p, i) => [p.join(','), i]));
    this.ranges = this.powers.map((p) =>
      p.every((n) => n % 2 === 0) ? { lo: 0, hi: 1 } : { lo: -1, hi: 1 },
    );
    this.ranges[0] = I.point(1);
    this.products = this.powers.map((a) =>
      this.powers.map((b) => indexes.get(a.map((n, i) => n + b[i]).join(',')) ?? -1),
    );
  }
  get statistics() {
    return { terms: this.used, operations: this.operations };
  }
  private constant(value: I.Interval): Model {
    return { coefficients: new Map([[0, value]]), error: zero() };
  }
  private read(t: Term): Model | undefined {
    const old = this.models.get(t.id);
    if (old) return old;
    const v = this.interval(t);
    // Opaque partial/conditional nodes keep their WHOLE range as an error.
    return finite(v) ? { coefficients: new Map(), error: v } : undefined;
  }
  private polynomial(m: Model) {
    let value = zero();
    for (const [key, coefficient] of m.coefficients)
      value = plus(value, key === 0 ? coefficient : I.times(coefficient, this.ranges[key]));
    return value;
  }
  private enclose(m: Model) {
    return plus(this.polynomial(m), m.error);
  }
  private save(t: Term, model: Model | undefined) {
    if (
      !this.powers.length ||
      !model ||
      this.models.has(t.id) ||
      this.used + model.coefficients.size > this.capacity ||
      !finite(this.enclose(model))
    )
      return;
    this.models.set(t.id, model);
    this.used += model.coefficients.size;
  }
  literal(t: Term, value: number) {
    this.save(t, this.constant(I.point(value)));
  }
  input(t: Term, name: string) {
    if (!this.powers.length) return;
    const d = this.assumptions[name];
    if (!d?.length) return;
    const lo = d[0].lo,
      hi = d.at(-1)!.hi;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (lo === hi) return this.literal(t, lo);
    const at = this.variables.indexOf(name),
      center = lo / 2 + hi / 2,
      // Directed subtraction covers midpoint rounding, including subnormals.
      radius = Math.max(
        I.minus(I.point(center), I.point(lo)).hi,
        I.minus(I.point(hi), I.point(center)).hi,
      );
    if (at < 0 || !Number.isFinite(radius)) return;
    this.save(t, {
      coefficients: new Map([
        [0, I.point(center)],
        [at + 1, I.point(radius)],
      ]),
      error: zero(),
    });
  }
  private add(a: Model, b: Model, sign = 1): Model {
    const coefficients = new Map(a.coefficients);
    for (const [key, value] of b.coefficients) {
      const v = sign === 1 ? value : { lo: -value.hi, hi: -value.lo };
      coefficients.set(key, plus(coefficients.get(key) ?? zero(), v));
    }
    return {
      coefficients,
      error: plus(a.error, sign === 1 ? b.error : { lo: -b.error.hi, hi: -b.error.lo }),
    };
  }
  private multiply(a: Model, b: Model): Model {
    const coefficients = new Map<number, I.Interval>();
    let error = plus(
      plus(I.times(this.polynomial(a), b.error), I.times(this.polynomial(b), a.error)),
      I.times(a.error, b.error),
    );
    for (const [i, x] of a.coefficients)
      for (const [j, y] of b.coefficients) {
        this.operations++;
        const product = I.times(x, y),
          at = this.products[i][j];
        if (at >= 0) coefficients.set(at, plus(coefficients.get(at) ?? zero(), product));
        else {
          const even = this.powers[i].every((p, k) => (p + this.powers[j][k]) % 2 === 0);
          error = plus(error, I.times(product, even ? { lo: 0, hi: 1 } : { lo: -1, hi: 1 }));
        }
      }
    return { coefficients, error };
  }
  private scale(m: Model, c: I.Interval) {
    return this.multiply(m, this.constant(c));
  }
  private analytic(m: Model, range: I.Interval, op: 'reciprocal' | 'sqrt' | 'log') {
    if (!finite(range) || (op !== 'reciprocal' ? range.lo <= 0 : range.lo <= 0 && range.hi >= 0))
      return;
    const center = range.lo / 2 + range.hi / 2,
      c = I.point(center),
      delta = this.add(m, this.constant(c), -1),
      d = I.minus(range, c),
      square = this.multiply(delta, delta);
    let a0: I.Interval, a1: I.Interval, a2: I.Interval, remainder: I.Interval;
    if (op === 'reciprocal') {
      a0 = I.divided(I.point(1), c);
      a1 = I.divided(I.point(-1), I.squared(c));
      a2 = I.divided(I.point(1), I.times(I.squared(c), c));
      // Exact finite geometric identity: no convergence-radius assumption.
      const d3 = I.times(I.squared(d), d);
      remainder = I.divided(I.times(I.point(-1), d3), I.times(I.times(I.squared(c), c), range));
    } else {
      const radius = Math.max(Math.abs(d.lo), Math.abs(d.hi)),
        radius3 = I.times(I.squared(I.point(radius)), I.point(radius));
      if (op === 'sqrt') {
        a0 = I.root(c);
        a1 = I.divided(I.point(1), I.times(I.point(2), a0));
        a2 = I.divided(I.point(-1), I.times(I.point(8), I.times(c, a0)));
        const lower = I.point(range.lo),
          denominator = I.times(I.point(16), I.times(I.squared(lower), I.root(lower)));
        const bound = I.divided(radius3, denominator).hi;
        remainder = { lo: -bound, hi: bound };
      } else {
        a0 = logDomains([c])[0];
        a1 = I.divided(I.point(1), c);
        a2 = I.divided(I.point(-1), I.times(I.point(2), I.squared(c)));
        const lower = I.point(range.lo),
          bound = I.divided(radius3, I.times(I.point(3), I.times(I.squared(lower), lower))).hi;
        remainder = { lo: -bound, hi: bound };
      }
    }
    const result = this.add(
      this.add(this.constant(a0), this.scale(delta, a1)),
      this.scale(square, a2),
    );
    result.error = plus(result.error, remainder);
    return result;
  }
  binary(t: Term, op: Binary, x: Term, y: Term) {
    if (!this.powers.length || this.used >= this.capacity || this.models.has(t.id)) return;
    const a = this.read(x),
      b = this.read(y);
    if (!a || !b) return;
    let result: Model | undefined;
    if (op === 'add' || op === 'subtract') result = this.add(a, b, op === 'add' ? 1 : -1);
    if (op === 'multiply') result = this.multiply(a, b);
    if (op === 'divide') {
      const inverse = this.analytic(b, this.interval(y), 'reciprocal');
      if (inverse) result = this.multiply(a, inverse);
    }
    if (op === 'hypot') {
      const square = this.add(this.multiply(a, a), this.multiply(b, b));
      result = this.analytic(
        square,
        I.intersection(this.enclose(square), { lo: 0, hi: Infinity }),
        'sqrt',
      );
    }
    this.save(t, result);
  }
  unary(t: Term, op: Unary, x: Term) {
    if (!this.powers.length || this.used >= this.capacity || this.models.has(t.id)) return;
    const a = this.read(x);
    if (a)
      this.save(
        t,
        op === 'cube'
          ? this.multiply(this.multiply(a, a), a)
          : this.analytic(a, this.interval(x), op),
      );
  }
  range(t: Term) {
    const m = this.models.get(t.id);
    return m && this.enclose(m);
  }
  difference(x: Term, y: Term) {
    if (!this.powers.length || this.used >= this.capacity) return;
    const a = this.read(x),
      b = this.read(y);
    return a && b ? this.enclose(this.add(a, b, -1)) : undefined;
  }
}
