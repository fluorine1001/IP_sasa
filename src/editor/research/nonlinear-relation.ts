import type { Interval } from '../interval';
import * as I from '../interval';
import type { HybridAlgebra } from '../../physics/hybrid-kernel';
import { logDomains, expDomains } from './log-domain';
import { trigRange } from './trig-domain';
import {
  entire,
  normalize,
  intersect,
  equal,
  squarePreimage,
  squareDomains,
  multiplyDomains,
  inverseProduct,
  addDomains,
  subtractDomains,
  divideDomains,
  cubeDomain,
  cubePreimage,
  hypotDomains,
  inverseHypot,
  maxDomains,
  inverseMax,
  type RealDomain,
} from './real-domains';

export type Term = Readonly<{ id: number; arena: symbol }>;
export type RelationNode = Readonly<{
  term: Term;
  op:
    | 'input'
    | 'literal'
    | 'multiply'
    | 'add'
    | 'subtract'
    | 'divide'
    | 'cube'
    | 'hypot'
    | 'max'
    | 'min'
    | 'sqrt'
    | 'log'
    | 'sin'
    | 'cos'
    | 'lt'
    | 'lte'
    | 'select';
  args: readonly Term[];
  value?: number;
  name?: string;
}>;
type Node = RelationNode;
export type TargetDomain = { term: Term; range: RealDomain };
export class NonlinearRelationLimit extends Error {
  constructor() {
    super('Nonlinear relation resource limit; no complete or empty-set answer was produced.');
    this.name = 'NonlinearRelationLimit';
  }
}

/** Real nonlinear relation contractor, NOT a complete success-set solver.
 * Retains the expression DAG and disjoint unary domains. Correlations remain
 * in the relation; the returned domain Cartesian product is NOT all successful.
 * Float evaluation of a shared kernel is distinct from a real-arithmetic proof.
 * Never use this backend to prune the actual game until rounding/events/goal
 * histories have a verified transformer. No mission-name branches or flights. */
export class NonlinearRelation implements HybridAlgebra<Term> {
  private arena = Symbol('nonlinear relation');
  private nodes: Node[] = [];
  private unique = new Map<string, Term>();
  private orders = new Map<string, number[]>();
  constructor(private limits: { nodes?: number } = {}) {}
  private make(op: Node['op'], args: readonly Term[], value?: number, name?: string): Term {
    args.forEach((a) => this.check(a));
    const signature = `${op}/${args.map((a) => a.id).join('/')}/${Object.is(value, -0) ? '-0' : value}/${name ?? ''}`;
    const found = this.unique.get(signature);
    if (found) return found;
    if (this.nodes.length >= (this.limits.nodes ?? 500_000)) throw new NonlinearRelationLimit();
    const term: Term = { id: this.nodes.length, arena: this.arena };
    this.nodes.push({ term, op, args, value, name });
    this.unique.set(signature, term);
    return term;
  }
  private check(term: Term) {
    if (!term || term.arena !== this.arena || this.nodes[term.id]?.term !== term)
      throw Error('Foreign nonlinear term.');
  }
  input(name: string) {
    return this.make('input', [], undefined, name);
  }
  constantValue(value: Term) {
    this.check(value);
    const node = this.nodes[value.id];
    return node.op === 'literal' ? node.value : undefined;
  }
  literal(value: number) {
    if (!Number.isFinite(value)) throw Error('Nonlinear constants must be finite.');
    return this.make('literal', [], value);
  }
  multiply(a: Term, b: Term) {
    return this.make('multiply', [a, b]);
  }
  add(a: Term, b: Term) {
    return this.make('add', [a, b]);
  }
  divide(a: Term, b: Term) {
    return this.make('divide', [a, b]);
  }
  cube(a: Term) {
    return this.make('cube', [a]);
  }
  hypot(a: Term, b: Term) {
    this.check(a);
    this.check(b);
    const factors = (t: Term) => {
      const n = this.nodes[t.id];
      if (n.op === 'sin' || n.op === 'cos')
        return { op: n.op, angle: n.args[0], scale: this.literal(1) };
      if (n.op === 'multiply')
        for (let i = 0; i < 2; i++) {
          const trig = this.nodes[n.args[i].id];
          if (trig.op === 'sin' || trig.op === 'cos')
            return { op: trig.op, angle: trig.args[0], scale: n.args[1 - i] };
        }
    };
    const x = factors(a),
      y = factors(b);
    const total = (t: Term, depth = 0): boolean => {
      if (depth > 16) return false;
      const n = this.nodes[t.id];
      if (n.op === 'input' || n.op === 'literal') return true;
      if (n.op === 'divide')
        return (
          this.constantValue(n.args[1]) !== undefined &&
          this.constantValue(n.args[1]) !== 0 &&
          total(n.args[0], depth + 1)
        );
      return (
        ['add', 'subtract', 'multiply', 'cube', 'sin', 'cos', 'hypot', 'min', 'max'].includes(
          n.op,
        ) && n.args.every((v) => total(v, depth + 1))
      );
    };
    if (x && y && x.op !== y.op && x.angle === y.angle && x.scale === y.scale && total(x.angle))
      return this.max(x.scale, this.multiply(this.literal(-1), x.scale));
    return this.make('hypot', [a, b]);
  }
  max(a: Term, b: Term) {
    return this.make('max', [a, b]);
  }
  subtract(a: Term, b: Term) {
    return this.make('subtract', [a, b]);
  }
  min(a: Term, b: Term) {
    return this.make('min', [a, b]);
  }
  sqrt(a: Term) {
    return this.make('sqrt', [a]);
  }
  log(a: Term) {
    return this.make('log', [a]);
  }
  sin(a: Term) {
    return this.make('sin', [a]);
  }
  cos(a: Term) {
    return this.make('cos', [a]);
  }
  lt(a: Term, b: Term) {
    this.check(a);
    this.check(b);
    const x = this.constantValue(a),
      y = this.constantValue(b);
    if (x !== undefined && y !== undefined) return this.literal(Number(x < y));
    return a === b ? this.literal(0) : this.make('lt', [a, b]);
  }
  lte(a: Term, b: Term) {
    this.check(a);
    this.check(b);
    const x = this.constantValue(a),
      y = this.constantValue(b);
    if (x !== undefined && y !== undefined) return this.literal(Number(x <= y));
    return a === b ? this.literal(1) : this.make('lte', [a, b]);
  }
  select(condition: Term, yes: Term, no: Term) {
    this.check(condition);
    this.check(yes);
    this.check(no);
    if (yes === no) return yes;
    const n = this.nodes[condition.id];
    if (n.op === 'literal') return n.value ? yes : no;
    return this.make('select', [condition, yes, no]);
  }
  get statistics() {
    return { nodes: this.nodes.length };
  }
  inputs(roots: readonly Term[]) {
    return this.ancestors(roots)
      .filter((id) => this.nodes[id].op === 'input')
      .map((id) => this.nodes[id].name!);
  }
  /** Read-only topological slice for certified algebraic boundary compilation.
   * Exposes the existing arithmetic, not independently assignable mode bits. */
  program(roots: readonly Term[]): readonly RelationNode[] {
    return this.ancestors(roots).map((id) => this.nodes[id]);
  }
  /** Recompile a shared SSA slice into a region-specialised algebra. This copies
   * nodes once, not paths or control assignments, and retains native op order. */
  rebase(
    roots: readonly Term[],
    target: NonlinearRelation,
    provenGuards?: ReadonlyMap<number, 0 | 1>,
  ): Term[] {
    const terms = new Map<number, Term>();
    for (const id of this.ancestors(roots)) {
      const n = this.nodes[id],
        args = n.args.map((t) => terms.get(t.id)!);
      let term: Term;
      const proven = provenGuards?.get(id);
      if (proven !== undefined && (n.op === 'lt' || n.op === 'lte')) {
        terms.set(id, target.literal(proven));
        continue;
      }
      switch (n.op) {
        case 'input':
          term = target.input(n.name!);
          break;
        case 'literal':
          term = target.literal(n.value!);
          break;
        case 'select':
          term = target.select(args[0], args[1], args[2]);
          break;
        case 'cube':
        case 'sqrt':
        case 'log':
        case 'sin':
        case 'cos':
          term = target[n.op](args[0]);
          break;
        default:
          term = target[n.op](args[0], args[1]);
      }
      terms.set(id, term);
    }
    return roots.map((t) => terms.get(t.id)!);
  }
  private ancestors(roots: readonly Term[]) {
    roots.forEach((t) => this.check(t));
    const key = roots.map((t) => t.id).join(','),
      cached = this.orders.get(key);
    if (cached) return cached;
    const active = new Set<number>(),
      order: number[] = [],
      stack = roots.map((t) => {
        this.check(t);
        return { id: t.id, expanded: false };
      });
    while (stack.length) {
      const { id, expanded } = stack.pop()!;
      if (expanded) {
        order.push(id);
        continue;
      }
      if (active.has(id)) continue;
      active.add(id);
      stack.push(
        { id, expanded: true },
        ...this.nodes[id].args.map((a) => ({ id: a.id, expanded: false })),
      );
    }
    if (this.orders.size >= 4) this.orders.delete(this.orders.keys().next().value!);
    this.orders.set(key, order);
    return order;
  }
  /** Point interpretation of the SAME graph, preserving native operation order.
   * This agreement is tested against actual engine ticks. It is not a proof that
   * the real-domain contractor encloses every rounded IEEE operation. */
  evaluator(roots: readonly Term[]) {
    const order = this.ancestors(roots),
      indexes = new Map(order.map((id, i) => [id, i]));
    const tape = order.map((id) => {
      const n = this.nodes[id];
      return {
        ...n,
        left: indexes.get(n.args[0]?.id)!,
        right: indexes.get(n.args[1]?.id)!,
        otherwise: indexes.get(n.args[2]?.id)!,
      };
    });
    const values = new Float64Array(order.length),
      outputs = roots.map((t) => indexes.get(t.id)!);
    return (assignment: Readonly<Record<string, number>>) => {
      for (let id = 0; id < tape.length; id++) {
        const n = tape[id],
          a = values[n.left],
          b = values[n.right];
        switch (n.op) {
          case 'input':
            if (!Number.isFinite(assignment[n.name!]))
              throw Error('Missing finite input: ' + n.name);
            values[id] = assignment[n.name!];
            break;
          case 'literal':
            values[id] = n.value!;
            break;
          case 'add':
            values[id] = a + b;
            break;
          case 'subtract':
            values[id] = a - b;
            break;
          case 'min':
            values[id] = Math.min(a, b);
            break;
          case 'sqrt':
            values[id] = Math.sqrt(a);
            break;
          case 'log':
            values[id] = Math.log(a);
            break;
          case 'sin':
          case 'cos':
            values[id] = Math[n.op](a);
            break;
          case 'lt':
            values[id] = Number(a < b);
            break;
          case 'lte':
            values[id] = Number(a <= b);
            break;
          case 'select':
            values[id] = a ? b : values[n.otherwise];
            break;
          case 'multiply':
            values[id] = a * b;
            break;
          case 'divide':
            values[id] = a / b;
            break;
          case 'cube':
            values[id] = a ** 3;
            break;
          case 'hypot':
            values[id] = Math.hypot(a, b);
            break;
          case 'max':
            values[id] = Math.max(a, b);
            break;
        }
      }
      return outputs.map((id) => values[id]);
    };
  }
  /** Mean-value inverse contractor. Reverse interval AD computes every control
   * derivative together, not N perturbed trajectories. Derivatives are evaluated
   * on the CONVEX HULL (including gaps) so center-to-point segments are covered.
   * Prefix/suffix residuals avoid an O(N^2) sum of all other controls. */
  private newton(
    active: readonly number[],
    domain: (id: number) => RealDomain,
    targets: readonly TargetDomain[],
    narrow: (id: number, desired: RealDomain) => void,
    limit: number,
  ) {
    let visits = 0,
      passes = 0;
    // A Boolean-valued target is either locally constant (zero derivative) or
    // discontinuous. Differentiating every physics node before noticing this
    // cannot contract a control. Arithmetic targets still use interval Newton.
    const booleans = new Set<number>();
    for (const id of active) {
      const n = this.nodes[id];
      if (
        n.op === 'lt' ||
        n.op === 'lte' ||
        (n.op === 'literal' && (n.value === 0 || n.value === 1)) ||
        (n.op === 'select' && booleans.has(n.args[1].id) && booleans.has(n.args[2].id)) ||
        (['multiply', 'min', 'max'].includes(n.op) && n.args.every((a) => booleans.has(a.id)))
      )
        booleans.add(id);
    }
    if (targets.every((t) => booleans.has(t.term.id))) return { visits: active.length, passes };
    // No mean-value derivative is substituted for a missing trig derivative
    // contract. Ordinary interval propagation remains available below.
    if (active.some((id) => this.nodes[id].op === 'sin' || this.nodes[id].op === 'cos'))
      return { visits: active.length, passes };
    const hull = (d: RealDomain): Interval =>
      d.length ? { lo: d[0].lo, hi: d.at(-1)!.hi } : I.whole();
    const inputs = [...active].filter((id) => this.nodes[id].op === 'input');
    if (
      inputs.some(
        (id) =>
          !domain(id).length ||
          !Number.isFinite(domain(id)[0].lo) ||
          !Number.isFinite(domain(id).at(-1)!.hi),
      )
    )
      return { visits, passes };
    const mid = new Map(
      inputs.map((id) => {
        const d = hull(domain(id));
        return [id, d.lo / 2 + d.hi / 2];
      }),
    );
    const range = (n: Node, values: ReadonlyMap<number, Interval>): Interval => {
      const a = values.get(n.args[0]?.id)!,
        b = values.get(n.args[1]?.id)!;
      switch (n.op) {
        case 'add':
          return I.plus(a, b);
        case 'subtract':
          return I.minus(a, b);
        case 'multiply':
          return n.args[0] === n.args[1] ? I.squared(a) : I.times(a, b);
        case 'divide':
          return I.divided(a, b);
        case 'cube':
          return cubeDomain(a);
        case 'hypot':
          return hull(hypotDomains([a], [b]));
        case 'max':
          return { lo: Math.max(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
        case 'min':
          return { lo: Math.min(a.lo, b.lo), hi: Math.min(a.hi, b.hi) };
        case 'sqrt':
          return a.lo < 0 ? I.whole() : I.root(a);
        case 'log':
          return a.lo <= 0 ? I.whole() : hull(logDomains([a]));
        case 'lt':
          return a.hi < b.lo ? I.point(1) : a.lo >= b.hi ? I.point(0) : { lo: 0, hi: 1 };
        case 'lte':
          return a.hi <= b.lo ? I.point(1) : a.lo > b.hi ? I.point(0) : { lo: 0, hi: 1 };
        case 'select': {
          const c = values.get(n.args[2].id)!;
          return a.lo === 1 && a.hi === 1
            ? b
            : a.lo === 0 && a.hi === 0
              ? c
              : { lo: Math.min(b.lo, c.lo), hi: Math.max(b.hi, c.hi) };
        }
        default:
          throw Error('Not an arithmetic node.');
      }
    };
    const frame = new Map<number, Interval>(),
      smooth = new Map<number, boolean>(),
      center = new Map<number, Interval>();
    for (const id of active) {
      if (visits + 2 > limit) return { visits, passes };
      visits += 2;
      const n = this.nodes[id];
      if (n.op === 'input') {
        frame.set(id, hull(domain(id)));
        center.set(id, I.point(mid.get(id)!));
        smooth.set(id, true);
      } else if (n.op === 'literal') {
        frame.set(id, I.point(n.value!));
        center.set(id, I.point(n.value!));
        smooth.set(id, true);
      } else {
        frame.set(id, range(n, frame));
        center.set(id, range(n, center));
        const left = frame.get(n.args[0].id)!,
          right = frame.get(n.args[1]?.id)!;
        let valid = n.args.every((t) => smooth.get(t.id));
        if (n.op === 'divide') valid &&= right.lo > 0 || right.hi < 0;
        if (n.op === 'log' || n.op === 'sqrt') valid &&= left.lo > 0;
        if (n.op === 'lt' || n.op === 'lte') valid &&= frame.get(id)!.lo === frame.get(id)!.hi;
        if (n.op === 'select') {
          const fixed = left.lo === left.hi && (left.lo === 0 || left.lo === 1);
          valid =
            fixed && !!smooth.get(n.args[0].id) && !!smooth.get(n.args[left.lo === 1 ? 1 : 2].id);
        }
        smooth.set(id, valid);
      }
    }
    const positive = I.point(1),
      zero = I.point(0),
      negative = I.point(-1);
    for (const target of targets) {
      if (!smooth.get(target.term.id)) continue;
      const adjoints = new Map<number, Interval>([[target.term.id, positive]]);
      const order = this.ancestors([target.term]);
      if (visits + order.length + inputs.length * 3 > limit) break;
      passes++;
      const push = (id: number, value: Interval) => {
        const old = adjoints.get(id);
        adjoints.set(id, old ? I.plus(old, value) : value);
      };
      for (let i = order.length - 1; i >= 0; i--) {
        visits++;
        const id = order[i],
          adjoint = adjoints.get(id),
          n = this.nodes[id];
        if (!adjoint || !n.args.length) continue;
        if (n.op === 'select') {
          const condition = frame.get(n.args[0].id)!;
          push(n.args[condition.lo === 1 ? 1 : 2].id, adjoint);
          continue;
        }
        const [a, b] = n.args.map((t) => t.id);
        let da: Interval, db: Interval | undefined;
        switch (n.op) {
          case 'add':
            da = db = positive;
            break;
          case 'subtract':
            da = positive;
            db = negative;
            break;
          case 'sqrt':
            da = I.divided(positive, I.times(I.point(2), frame.get(id)!));
            break;
          case 'log':
            da = I.divided(positive, frame.get(a)!);
            break;
          case 'multiply':
            da = frame.get(b)!;
            db = frame.get(a)!;
            break;
          case 'divide':
            da = I.divided(positive, frame.get(b)!);
            db = I.times(negative, I.divided(frame.get(a)!, I.squared(frame.get(b)!)));
            break;
          case 'cube':
            da = I.times(I.point(3), I.squared(frame.get(a)!));
            break;
          case 'hypot':
            da = I.divided(frame.get(a)!, frame.get(id)!);
            db = I.divided(frame.get(b)!, frame.get(id)!);
            break;
          case 'max':
          case 'min': {
            const greater = n.op === 'max';
            da = (
              greater ? frame.get(a)!.lo > frame.get(b)!.hi : frame.get(a)!.hi < frame.get(b)!.lo
            )
              ? positive
              : (
                    greater
                      ? frame.get(a)!.hi < frame.get(b)!.lo
                      : frame.get(a)!.lo > frame.get(b)!.hi
                  )
                ? zero
                : { lo: 0, hi: 1 };
            db = (
              greater ? frame.get(b)!.lo > frame.get(a)!.hi : frame.get(b)!.hi < frame.get(a)!.lo
            )
              ? positive
              : (
                    greater
                      ? frame.get(b)!.hi < frame.get(a)!.lo
                      : frame.get(b)!.lo > frame.get(a)!.hi
                  )
                ? zero
                : { lo: 0, hi: 1 };
            break;
          }
          default:
            continue;
        }
        push(a, I.times(adjoint, da));
        if (db) push(b, I.times(adjoint, db));
      }
      const derivatives = inputs.map((id) => adjoints.get(id) ?? zero);
      const contributions = inputs.map((id, i) =>
        I.times(derivatives[i], I.minus(frame.get(id)!, I.point(mid.get(id)!))),
      );
      const prefix: Interval[] = [zero],
        suffix: Interval[] = Array(inputs.length + 1);
      suffix[inputs.length] = zero;
      for (let i = 0; i < inputs.length; i++) {
        prefix.push(I.plus(prefix[i], contributions[i]));
        visits++;
      }
      for (let i = inputs.length - 1; i >= 0; i--) {
        suffix[i] = I.plus(suffix[i + 1], contributions[i]);
        visits++;
      }
      for (let i = 0; i < inputs.length; i++) {
        visits++;
        const residual = subtractDomains(
          subtractDomains(target.range, [center.get(target.term.id)!]),
          [I.plus(prefix[i], suffix[i + 1])],
        );
        const inverse = inverseProduct(residual, [derivatives[i]]);
        narrow(inputs[i], addDomains([I.point(mid.get(inputs[i])!)], inverse));
      }
    }
    return { visits, passes };
  }
  contract(
    bounds: Readonly<Record<string, RealDomain>>,
    targets: readonly TargetDomain[],
    options: { work?: number; newton?: boolean; enclosures?: ReadonlyMap<number, Interval> } = {},
  ) {
    const active = this.ancestors(targets.map((t) => t.term)),
      positions = new Map(active.map((id, i) => [id, i]));
    const domains = active.map((id) => {
      const n = this.nodes[id];
      if (n.op === 'literal') return [{ lo: n.value!, hi: n.value! }];
      if (n.op === 'input') {
        if (!bounds[n.name!]) throw Error('Missing input domain: ' + n.name);
        return normalize(bounds[n.name!]);
      }
      const enclosure = options.enclosures?.get(id);
      return enclosure && I.valid(enclosure) ? [{ ...enclosure }] : entire();
    });
    const domain = (id: number) => domains[positions.get(id)!];
    const consumers = active.map(() => [] as number[]);
    for (const id of active)
      for (const a of this.nodes[id].args) consumers[positions.get(a.id)!].push(id);
    const queue = new Int32Array(Math.max(1, active.length)),
      queued = new Uint8Array(active.length);
    let head = 0,
      tail = 0,
      pending = 0,
      visits = 0,
      changes = 0,
      empty = false;
    const enqueue = (id: number) => {
      const at = positions.get(id);
      if (at === undefined || queued[at]) return;
      queue[tail] = at;
      tail = (tail + 1) % queue.length;
      pending++;
      queued[at] = 1;
    };
    const narrow = (id: number, desired: RealDomain) => {
      const at = positions.get(id)!,
        next = intersect(domains[at], normalize(desired));
      if (!next.length) empty = true;
      if (equal(next, domains[at])) return;
      domains[at] = next;
      changes++;
      enqueue(id);
      for (const p of consumers[at]) enqueue(p);
    };
    for (const t of targets) narrow(t.term.id, t.range);
    for (const id of active) {
      if (!domain(id).length) empty = true;
      enqueue(id);
    }
    const limit = options.work ?? Math.max(4096, active.length * 256);
    // Certify guards on the full convex input hull, NOT on target-assumed branch
    // values. Only certified single-mode slices permit mean-value derivatives.
    const analysis =
      options.newton === false
        ? { visits: 0, passes: 0 }
        : this.newton(active, domain, targets, narrow, limit);
    const newtonVisits = analysis.visits;
    visits += newtonVisits;
    while (pending && !empty && visits < limit) {
      const at = queue[head],
        id = active[at];
      head = (head + 1) % queue.length;
      pending--;
      queued[at] = 0;
      visits++;
      const n = this.nodes[id];
      if (n.op === 'input' || n.op === 'literal') continue;
      const [a, b] = n.args.map((t) => t.id);
      switch (n.op) {
        case 'subtract':
          narrow(id, subtractDomains(domain(a), domain(b)));
          narrow(a, addDomains(domain(id), domain(b)));
          narrow(b, subtractDomains(domain(a), domain(id)));
          break;
        case 'sin':
        case 'cos':
          narrow(id, normalize(domain(a).map((d) => trigRange(d, n.op as 'sin' | 'cos'))));
          break;
        case 'min': {
          const negate = (d: RealDomain) => d.map((p) => ({ lo: -p.hi, hi: -p.lo })).reverse();
          narrow(id, negate(maxDomains(negate(domain(a)), negate(domain(b)))));
          narrow(a, negate(inverseMax(negate(domain(id)), negate(domain(b)))));
          narrow(b, negate(inverseMax(negate(domain(id)), negate(domain(a)))));
          break;
        }
        case 'sqrt':
          // An inactive select branch may be undefined. Without a definedness
          // transformer, widen that partial operation; do NOT restrict a shared
          // input to make an unselected branch evaluable.
          if (domain(a).some((p) => p.lo < 0)) break;
          narrow(a, [{ lo: 0, hi: Infinity }]);
          narrow(id, normalize(domain(a).map(I.root)));
          narrow(a, squareDomains(domain(id)));
          break;
        case 'log':
          if (domain(a).some((p) => p.lo <= 0)) break;
          narrow(a, [{ lo: 0, hi: Infinity }]);
          narrow(id, logDomains(domain(a)));
          narrow(a, expDomains(domain(id)));
          break;
        case 'lt':
        case 'lte': {
          const x = domain(a),
            y = domain(b);
          if (!x.length || !y.length) break;
          const strict = n.op === 'lt';
          const yes = strict ? x[0].lo < y.at(-1)!.hi : x[0].lo <= y.at(-1)!.hi;
          const no = strict ? x.at(-1)!.hi >= y[0].lo : x.at(-1)!.hi > y[0].lo;
          narrow(id, [...(yes ? [{ lo: 1, hi: 1 }] : []), ...(no ? [{ lo: 0, hi: 0 }] : [])]);
          const truth = domain(id);
          if (truth.length === 1 && truth[0].lo === truth[0].hi) {
            if (truth[0].lo === 1) {
              narrow(a, [{ lo: -Infinity, hi: y.at(-1)!.hi }]);
              narrow(b, [{ lo: x[0].lo, hi: Infinity }]);
            } else {
              narrow(a, [{ lo: y[0].lo, hi: Infinity }]);
              narrow(b, [{ lo: -Infinity, hi: x.at(-1)!.hi }]);
            }
          }
          break;
        }
        case 'select': {
          const c = n.args[2].id;
          narrow(a, [
            { lo: 0, hi: 0 },
            { lo: 1, hi: 1 },
          ]);
          const allows = (v: number) => domain(a).some((p) => p.lo <= v && v <= p.hi);
          narrow(id, normalize([...(allows(1) ? domain(b) : []), ...(allows(0) ? domain(c) : [])]));
          if (!intersect(domain(id), domain(b)).length) narrow(a, [{ lo: 0, hi: 0 }]);
          if (!intersect(domain(id), domain(c)).length) narrow(a, [{ lo: 1, hi: 1 }]);
          if (!allows(0)) narrow(b, domain(id));
          if (!allows(1)) narrow(c, domain(id));
          break;
        }
        case 'multiply':
          if (a === b) {
            narrow(id, squareDomains(domain(a)));
            narrow(a, squarePreimage(domain(id)));
          } else {
            narrow(id, multiplyDomains(domain(a), domain(b)));
            narrow(a, inverseProduct(domain(id), domain(b)));
            narrow(b, inverseProduct(domain(id), domain(a)));
          }
          break;
        case 'add':
          narrow(id, addDomains(domain(a), domain(b)));
          narrow(a, subtractDomains(domain(id), domain(b)));
          narrow(b, subtractDomains(domain(id), domain(a)));
          break;
        case 'divide':
          if (domain(b).some((p) => p.lo <= 0 && p.hi >= 0)) break;
          narrow(id, divideDomains(domain(a), domain(b)));
          narrow(a, multiplyDomains(domain(id), domain(b)));
          narrow(b, inverseProduct(domain(a), domain(id)));
          break;
        case 'cube':
          narrow(id, normalize(domain(a).map(cubeDomain)));
          narrow(a, cubePreimage(domain(id)));
          break;
        case 'hypot':
          narrow(id, hypotDomains(domain(a), domain(b)));
          narrow(a, inverseHypot(domain(id), domain(b)));
          narrow(b, inverseHypot(domain(id), domain(a)));
          break;
        case 'max':
          narrow(id, maxDomains(domain(a), domain(b)));
          narrow(a, inverseMax(domain(id), domain(b)));
          narrow(b, inverseMax(domain(id), domain(a)));
          break;
      }
    }
    const result: Record<string, Interval[]> = Object.fromEntries(
      Object.entries(bounds).map(([name, d]) => [name, normalize(d)]),
    );
    for (const id of active) {
      const n = this.nodes[id];
      if (n.op === 'input') result[n.name!] = domain(id);
    }
    return {
      empty,
      fixedPoint: empty || pending === 0,
      domains: result,
      statistics: {
        visits,
        newtonVisits,
        newtonPasses: analysis.passes,
        changes,
        nodes: active.length,
      },
    };
  }
}
