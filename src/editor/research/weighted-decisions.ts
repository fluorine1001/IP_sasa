import { DecisionSets, DecisionSetLimit, type DecisionSet } from './decision-set';
import { VariableOrder } from './variable-order';

/** A weight n + e*epsilon, ordered lexicographically, epsilon positive and
 * infinitesimal. Strict timing inequalities use e=-1. No floating tolerance. */
export type Weight = Readonly<{ n: bigint; e: bigint }>;
export type WeightedSet = Readonly<{ node: number; offset: Weight }>;
type Node = {
  variable: number;
  low: WeightedSet;
  high: WeightedSet;
  max?: Weight;
  stride: bigint;
  epsilonZero: boolean;
};
const zero: Weight = { n: 0n, e: 0n };
const add = (a: Weight, b: Weight): Weight => ({ n: a.n + b.n, e: a.e + b.e });
const sub = (a: Weight, b: Weight): Weight => ({ n: a.n - b.n, e: a.e - b.e });
const compare = (a: Weight, b: Weight) =>
  a.n < b.n ? -1 : a.n > b.n ? 1 : a.e < b.e ? -1 : a.e > b.e ? 1 : 0;
const gcd = (a: bigint, b: bigint) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return a;
};
const key = (r: WeightedSet) => `${r.node}:${r.offset.n}:${r.offset.e}`;

/** Edge-valued decision diagrams. Normalising additive offsets lets a sum of
 * N independent weights have N nodes even when all 2^N values differ. This is
 * an exact finite-choice weight algebra, NOT general nonlinear reachability. */
export class WeightedDecisions {
  private ordering: VariableOrder;
  readonly infinity: WeightedSet = { node: 0, offset: zero };
  private nodes: (Node | undefined)[] = [undefined, undefined];
  private unique = new Map<string, number>();
  private cache = new Map<string, WeightedSet>();
  private expansions = 0;
  private latticeMerges = 0;
  constructor(private limits: { nodes?: number; work?: number; order?: VariableOrder } = {}) {
    this.ordering = limits.order ?? new VariableOrder();
  }
  get statistics() {
    return {
      nodes: this.nodes.length,
      expansions: this.expansions,
      latticeMerges: this.latticeMerges,
    };
  }
  constant(n: bigint, strict = false): WeightedSet {
    return { node: 1, offset: { n, e: strict ? -1n : 0n } };
  }
  private shift(r: WeightedSet, amount: Weight): WeightedSet {
    return r.node === 0 ? this.infinity : { node: r.node, offset: add(r.offset, amount) };
  }
  private top(r: WeightedSet) {
    return r.node < 2 ? Infinity : this.nodes[r.node]!.variable;
  }
  private maximum(r: WeightedSet): Weight | undefined {
    if (r.node === 0) return;
    if (r.node === 1) return r.offset;
    const m = this.nodes[r.node]!.max;
    return m && add(r.offset, m);
  }
  private make(variable: number, low: WeightedSet, high: WeightedSet): WeightedSet {
    if (key(low) === key(high)) return low;
    if (low.node === 0 && high.node === 0) return this.infinity;
    if (
      this.ordering.compare(this.top(low), variable) <= 0 ||
      this.ordering.compare(this.top(high), variable) <= 0
    )
      throw Error('Unordered weighted node.');
    const base =
      low.node === 0
        ? high.offset
        : high.node === 0
          ? low.offset
          : compare(low.offset, high.offset) <= 0
            ? low.offset
            : high.offset;
    low = low.node === 0 ? low : { node: low.node, offset: sub(low.offset, base) };
    high = high.node === 0 ? high : { node: high.node, offset: sub(high.offset, base) };
    const signature = `${variable}/${key(low)}/${key(high)}`;
    let id = this.unique.get(signature);
    if (id === undefined) {
      if (this.nodes.length >= (this.limits.nodes ?? 500_000)) throw new DecisionSetLimit();
      const loMax = this.maximum(low),
        hiMax = this.maximum(high);
      let stride = 0n,
        epsilonZero = true;
      for (const child of [low, high]) {
        if (!child.node) continue;
        stride = gcd(stride, child.offset.n);
        if (child.node > 1) stride = gcd(stride, this.nodes[child.node]!.stride);
        epsilonZero &&=
          child.offset.e === 0n && (child.node === 1 || this.nodes[child.node]!.epsilonZero);
      }
      id =
        this.nodes.push({
          variable,
          low,
          high,
          stride,
          epsilonZero,
          max: loMax && hiMax ? (compare(loMax, hiMax) >= 0 ? loMax : hiMax) : undefined,
        }) - 1;
      this.unique.set(signature, id);
    }
    return { node: id, offset: base };
  }
  choose(
    sets: DecisionSets,
    condition: DecisionSet,
    yes: WeightedSet,
    no = this.infinity,
  ): WeightedSet {
    const indicator = (root: DecisionSet) =>
      sets.fold(
        root,
        (v) => (v ? this.constant(0n) : this.infinity),
        (variable, low, high) => this.make(variable, low, high),
      );
    const a = this.add(indicator(condition), yes);
    return no.node === 0 ? a : this.min(a, this.add(indicator(sets.not(condition)), no));
  }
  add(a: WeightedSet, b: WeightedSet) {
    return this.apply('add', a, b);
  }
  min(a: WeightedSet, b: WeightedSet) {
    return this.apply('min', a, b);
  }
  private apply(operation: 'add' | 'min', a: WeightedSet, b: WeightedSet): WeightedSet {
    if (this.cache.size > (this.limits.nodes ?? 500_000) * 2) this.cache.clear();
    type Description =
      | { value: WeightedSet }
      | {
          key: string;
          base: Weight;
          variable: number;
          low: [WeightedSet, WeightedSet];
          high: [WeightedSet, WeightedSet];
        };
    const describe = (a: WeightedSet, b: WeightedSet): Description => {
      if (!a.node || !b.node)
        return { value: operation === 'add' ? this.infinity : a.node ? a : b };
      if (operation === 'add' && (a.node === 1 || b.node === 1))
        return { value: a.node === 1 ? this.shift(b, a.offset) : this.shift(a, b.offset) };
      if (operation === 'min') {
        const maxA = this.maximum(a),
          maxB = this.maximum(b);
        if (maxB && compare(a.offset, maxB) >= 0) return { value: b };
        if (maxA && compare(b.offset, maxA) >= 0) return { value: a };
        if (a.node === b.node) return { value: compare(a.offset, b.offset) <= 0 ? a : b };
      }
      const base =
        operation === 'add'
          ? add(a.offset, b.offset)
          : compare(a.offset, b.offset) <= 0
            ? a.offset
            : b.offset;
      a = { node: a.node, offset: operation === 'add' ? zero : sub(a.offset, base) };
      b = { node: b.node, offset: operation === 'add' ? zero : sub(b.offset, base) };
      if (key(a) > key(b)) [a, b] = [b, a];
      const variable = this.ordering.first(this.top(a), this.top(b));
      const at = (r: WeightedSet, high: boolean) =>
        this.top(r) === variable
          ? this.shift(this.nodes[r.node]![high ? 'high' : 'low'], r.offset)
          : r;
      return {
        key: `${operation}/${key(a)}/${key(b)}`,
        base,
        variable,
        low: [at(a, false), at(b, false)],
        high: [at(a, true), at(b, true)],
      };
    };
    const lookup = (a: WeightedSet, b: WeightedSet) => {
      const d = describe(a, b);
      return 'value' in d ? d.value : this.shift(this.cache.get(d.key)!, d.base);
    };
    const stack = [{ a, b, expanded: false }];
    let work = 0;
    while (stack.length) {
      if (++work > (this.limits.work ?? 2_000_000)) throw new DecisionSetLimit();
      const f = stack.pop()!,
        d = describe(f.a, f.b);
      if ('value' in d || this.cache.has(d.key)) continue;
      if (f.expanded)
        this.cache.set(d.key, this.make(d.variable, lookup(...d.low), lookup(...d.high)));
      else {
        this.expansions++;
        stack.push(
          { ...f, expanded: true },
          { a: d.high[0], b: d.high[1], expanded: false },
          { a: d.low[0], b: d.low[1], expanded: false },
        );
      }
    }
    return lookup(a, b);
  }
  negate(root: WeightedSet): WeightedSet {
    if (!root.node) throw Error('Negative infinity is not a timing upper bound.');
    const result = new Map<number, WeightedSet>([[1, this.constant(0n)]]),
      stack = [{ node: root.node, expanded: false }];
    const negative = (r: WeightedSet) =>
      this.shift(result.get(r.node)!, { n: -r.offset.n, e: -r.offset.e });
    while (stack.length) {
      const f = stack.pop()!;
      if (result.has(f.node)) continue;
      const n = this.nodes[f.node]!;
      if (!n.low.node || !n.high.node)
        throw Error('Cannot negate a function with infinite branches.');
      if (f.expanded) result.set(f.node, this.make(n.variable, negative(n.low), negative(n.high)));
      else
        stack.push(
          { ...f, expanded: true },
          { node: n.high.node, expanded: false },
          { node: n.low.node, expanded: false },
        );
    }
    return negative(root);
  }
  less(a: WeightedSet, b: WeightedSet, sets: DecisionSets) {
    return this.negative(this.add(a, this.negate(b)), sets);
  }
  negative(root: WeightedSet, sets: DecisionSets): DecisionSet {
    const memo = new Map<string, DecisionSet>();
    const canonical = (r: WeightedSet): WeightedSet => {
      if (r.node < 2) return r;
      const node = this.nodes[r.node]!,
        stride = node.stride;
      if (!stride) return r;
      let quotient = r.offset.n / stride,
        remainder = r.offset.n % stride;
      if (remainder < 0n) {
        quotient--;
        remainder += stride;
      }
      const offset = {
        n: quotient * stride + (remainder ? 1n : 0n),
        e: remainder ? 0n : node.epsilonZero ? (r.offset.e < 0n ? -1n : 0n) : r.offset.e,
      };
      if (compare(offset, r.offset)) this.latticeMerges++;
      return { node: r.node, offset };
    };
    const simple = (r: WeightedSet): DecisionSet | undefined => {
      if (!r.node || compare(r.offset, zero) >= 0) return sets.empty;
      const max = this.maximum(r);
      if (max && compare(max, zero) < 0) return sets.all;
      if (r.node === 1) return sets.all;
    };
    const stack = [{ root: canonical(root), expanded: false }];
    let work = 0;
    while (stack.length) {
      if (++work > (this.limits.work ?? 2_000_000)) throw new DecisionSetLimit();
      const f = stack.pop()!,
        k = key(f.root);
      if (memo.has(k)) continue;
      const base = simple(f.root);
      if (base !== undefined) {
        memo.set(k, base);
        continue;
      }
      const n = this.nodes[f.root.node]!;
      const low = canonical(this.shift(n.low, f.root.offset)),
        high = canonical(this.shift(n.high, f.root.offset));
      if (f.expanded)
        memo.set(k, sets.ite(sets.variable(n.variable), memo.get(key(high))!, memo.get(key(low))!));
      else
        stack.push(
          { ...f, expanded: true },
          { root: high, expanded: false },
          { root: low, expanded: false },
        );
    }
    return memo.get(key(canonical(root)))!;
  }
  evaluate(root: WeightedSet, assignment: (variable: number) => boolean): Weight | undefined {
    let result = root.offset;
    while (root.node > 1) {
      const n = this.nodes[root.node]!;
      root = assignment(n.variable) ? n.high : n.low;
      result = add(result, root.offset);
    }
    return root.node ? result : undefined;
  }
  /** Evaluate many shared roots for ONE fixed choice. Each reachable decision
   * node is evaluated at most once, rather than once per prefix/root. No values
   * from a different assignment are reused. Explicit stack avoids recursion. */
  evaluator(assignment: (variable: number) => boolean, work?: { decisionNodes: number }) {
    const known = new Map<number, Weight | undefined>([
      [0, undefined],
      [1, zero],
    ]);
    return (root: WeightedSet): Weight | undefined => {
      const stack: { node: number; child: WeightedSet }[] = [];
      let at = root.node;
      while (!known.has(at)) {
        if (work) work.decisionNodes++;
        const node = this.nodes[at]!,
          child = node[assignment(node.variable) ? 'high' : 'low'];
        stack.push({ node: at, child });
        at = child.node;
      }
      while (stack.length) {
        const f = stack.pop()!,
          value = known.get(f.child.node);
        known.set(f.node, value ? add(f.child.offset, value) : undefined);
      }
      const value = known.get(root.node);
      return value && add(root.offset, value);
    };
  }
}
