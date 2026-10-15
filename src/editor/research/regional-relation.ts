import { NonlinearRelation, type Term } from './nonlinear-relation';
import * as I from '../interval';
import { equal, intersect, normalize, type RealDomain } from './real-domains';
import { logDomains } from './log-domain';

/** Region-specialised real relation. A single forward enclosure per DAG node
 * proves constant guards before they duplicate fuel/history modes. No control
 * samples or branch guesses. Assumption checks prevent reusing the compiled
 * program on a wider input region. Float representatives still need game replay. */
export function regionalRelation(
  assumptions: Readonly<Record<string, RealDomain>>,
  limits: { nodes?: number } = {},
) {
  const r = new NonlinearRelation(limits),
    metadata = new Map<number, { range: I.Interval; defined: boolean }>();
  const domains = Object.fromEntries(
    Object.entries(assumptions).map(([k, d]) => [k, normalize(d)]),
  );
  const read = (t: Term) => {
    r.constantValue(t);
    return metadata.get(t.id) ?? { range: I.whole(), defined: false };
  };
  const record = (t: Term, range: I.Interval, defined: boolean) => {
    const value = r.constantValue(t);
    metadata.set(
      t.id,
      value === undefined ? { range, defined } : { range: I.point(value), defined: true },
    );
    return t;
  };
  const literal = r.literal.bind(r),
    input = r.input.bind(r);
  r.literal = (v) => record(literal(v), I.point(v), true);
  r.input = (name) => {
    const d = domains[name];
    if (!d?.length) throw Error('Missing regional input.');
    return record(input(name), { lo: d[0].lo, hi: d.at(-1)!.hi }, true);
  };
  const binary = (
    op: 'add' | 'subtract' | 'multiply' | 'divide' | 'hypot' | 'min' | 'max',
    range: (a: I.Interval, b: I.Interval) => I.Interval,
  ) => {
    const base = r[op].bind(r);
    r[op] = (x, y) => {
      const a = read(x),
        b = read(y),
        u = r.constantValue(x),
        v = r.constantValue(y);
      // Exact real identities, not rounded constant evaluation. In particular
      // Boolean arithmetic must not turn 1 * 1 into an uncertain mode guard.
      if (op === 'multiply') {
        if (u === 1) return y;
        if (v === 1) return x;
        if ((u === 0 && b.defined) || (v === 0 && a.defined)) return r.literal(0);
      }
      if (op === 'add' && u === 0) return y;
      if ((op === 'add' || op === 'subtract') && v === 0) return x;
      if (op === 'subtract' && x === y && a.defined) return r.literal(0);
      if (op === 'divide' && v === 1) return x;
      if ((op === 'min' || op === 'max') && x === y) return x;
      return record(
        base(x, y),
        range(a.range, b.range),
        a.defined && b.defined && (op !== 'divide' || b.range.lo > 0 || b.range.hi < 0),
      );
    };
  };
  binary('add', I.plus);
  binary('subtract', I.minus);
  binary('multiply', I.times);
  binary('divide', I.divided);
  binary('hypot', (a, b) => I.root(I.plus(I.squared(a), I.squared(b))));
  binary('min', (a, b) => ({ lo: Math.min(a.lo, b.lo), hi: Math.min(a.hi, b.hi) }));
  binary('max', (a, b) => ({ lo: Math.max(a.lo, b.lo), hi: Math.max(a.hi, b.hi) }));
  const cube = r.cube.bind(r),
    sqrt = r.sqrt.bind(r),
    log = r.log.bind(r);
  r.cube = (x) => {
    const a = read(x),
      lo = I.times(I.squared(I.point(a.range.lo)), I.point(a.range.lo)).lo,
      hi = I.times(I.squared(I.point(a.range.hi)), I.point(a.range.hi)).hi;
    return record(cube(x), { lo, hi }, a.defined);
  };
  r.sqrt = (x) => {
    const a = read(x);
    return record(
      sqrt(x),
      a.range.lo < 0 ? I.whole() : I.root(a.range),
      a.defined && a.range.lo >= 0,
    );
  };
  r.log = (x) => {
    const a = read(x),
      d = a.range.lo > 0 ? logDomains([a.range])[0] : I.whole();
    return record(log(x), d, a.defined && a.range.lo > 0);
  };
  for (const op of ['lt', 'lte'] as const) {
    const base = r[op].bind(r);
    r[op] = (x, y) => {
      const a = read(x),
        b = read(y);
      if (a.defined && b.defined) {
        const yes = op === 'lt' ? a.range.hi < b.range.lo : a.range.hi <= b.range.lo;
        const no = op === 'lt' ? a.range.lo >= b.range.hi : a.range.lo > b.range.hi;
        if (yes || no) return r.literal(Number(yes));
      }
      return record(base(x, y), { lo: 0, hi: 1 }, a.defined && b.defined);
    };
  }
  const select = r.select.bind(r);
  r.select = (condition, yes, no) => {
    const c = read(condition),
      a = read(yes),
      b = read(no);
    if (c.defined && c.range.lo === c.range.hi) return c.range.lo ? yes : no;
    return record(
      select(condition, yes, no),
      { lo: Math.min(a.range.lo, b.range.lo), hi: Math.max(a.range.hi, b.range.hi) },
      c.defined && a.defined && b.defined,
    );
  };
  const contract = r.contract.bind(r),
    evaluator = r.evaluator.bind(r);
  r.contract = (bounds, targets, options) => {
    for (const [name, d] of Object.entries(bounds))
      if (domains[name] && !equal(normalize(d), intersect(normalize(d), domains[name])))
        throw Error('Regional assumption violation.');
    return contract(bounds, targets, options);
  };
  r.evaluator = (roots) => {
    const evaluate = evaluator(roots);
    return (assignment) => {
      for (const [name, d] of Object.entries(domains))
        if (
          Object.hasOwn(assignment, name) &&
          !d.some((p) => p.lo <= assignment[name] && assignment[name] <= p.hi)
        )
          throw Error('Regional assumption violation.');
      return evaluate(assignment);
    };
  };
  return Object.assign(r, {
    enclosure: (term: Term) => {
      const value = read(term);
      return { defined: value.defined, range: { ...value.range } };
    },
  });
}
