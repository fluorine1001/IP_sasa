/** Research backend: exact finite Boolean sets, not a nonlinear physics solver.
 * Roots represent whole sets of choices. Relational product/quantification never
 * enumerate their assignments. Numeric predicates still need a physical theory
 * solver: treating independent predicate bits as physics would admit false plans.
 */
import { VariableOrder } from './variable-order';
export type DecisionSet = number;
type Node = { variable: number; low: DecisionSet; high: DecisionSet };
type Triple = [DecisionSet, DecisionSet, DecisionSet];

export class DecisionSetLimit extends Error {
  constructor() {
    super('Symbolic set resource limit; no completeness or empty-set result was produced.');
    this.name = 'DecisionSetLimit';
  }
}

/** Reduced ordered BDD with shared nodes and memoised ITE. The immutable order
 * is configurable; size depends on that order and can be exponential.
 * Explicit stacks avoid JS call-stack limits on long timelines. */
export class DecisionSets {
  readonly ordering: VariableOrder;
  readonly empty: DecisionSet = 0;
  readonly all: DecisionSet = 1;
  private nodes: Node[] = [
    { variable: Infinity, low: 0, high: 0 },
    { variable: Infinity, low: 1, high: 1 },
  ];
  private unique = new Map<string, DecisionSet>();
  private cache = new Map<string, DecisionSet>();
  private expansions = 0;
  private hits = 0;
  constructor(private limits: { nodes?: number; work?: number; order?: readonly number[] } = {}) {
    this.ordering = new VariableOrder(limits.order);
  }

  get statistics() {
    return { nodes: this.nodes.length, expansions: this.expansions, cacheHits: this.hits };
  }
  private check(root: DecisionSet) {
    if (!Number.isSafeInteger(root) || root < 0 || root >= this.nodes.length)
      throw Error('Decision-set root does not belong to this arena.');
  }
  private index(variable: number) {
    if (!Number.isSafeInteger(variable) || variable < 0) throw Error('Invalid Boolean variable.');
  }
  private make(variable: number, low: DecisionSet, high: DecisionSet): DecisionSet {
    if (low === high) return low;
    if (
      this.ordering.compare(this.nodes[low].variable, variable) <= 0 ||
      this.ordering.compare(this.nodes[high].variable, variable) <= 0
    )
      throw Error('Unordered symbolic node.');
    const key = `${variable}/${low}/${high}`;
    const old = this.unique.get(key);
    if (old !== undefined) return old;
    if (this.nodes.length >= (this.limits.nodes ?? 500_000)) throw new DecisionSetLimit();
    const root = this.nodes.push({ variable, low, high }) - 1;
    this.unique.set(key, root);
    return root;
  }
  variable(index: number): DecisionSet {
    this.index(index);
    return this.make(index, this.empty, this.all);
  }
  ite(condition: DecisionSet, yes: DecisionSet, no: DecisionSet): DecisionSet {
    for (const root of [condition, yes, no]) this.check(root);
    if (this.cache.size > (this.limits.nodes ?? 500_000) * 2) this.cache.clear();
    const stack: { triple: Triple; expanded: boolean }[] = [
      { triple: [condition, yes, no], expanded: false },
    ];
    let work = 0;
    const key = (t: Triple) => t.join('/');
    while (stack.length) {
      if (++work > (this.limits.work ?? 2_000_000)) throw new DecisionSetLimit();
      const frame = stack.pop()!,
        [i, t, e] = frame.triple,
        k = key(frame.triple);
      if (this.cache.has(k)) {
        this.hits++;
        continue;
      }
      const simple = i === 0 ? e : i === 1 ? t : t === e ? t : t === 1 && e === 0 ? i : undefined;
      if (simple !== undefined) {
        this.cache.set(k, simple);
        continue;
      }
      const variable = this.ordering.first(
        this.nodes[i].variable,
        this.ordering.first(this.nodes[t].variable, this.nodes[e].variable),
      );
      const at = (r: number, high: boolean) =>
        this.nodes[r].variable === variable ? this.nodes[r][high ? 'high' : 'low'] : r;
      const low: Triple = [at(i, false), at(t, false), at(e, false)];
      const high: Triple = [at(i, true), at(t, true), at(e, true)];
      if (frame.expanded)
        this.cache.set(
          k,
          this.make(variable, this.cache.get(key(low))!, this.cache.get(key(high))!),
        );
      else {
        this.expansions++;
        stack.push(
          { ...frame, expanded: true },
          { triple: high, expanded: false },
          { triple: low, expanded: false },
        );
      }
    }
    return this.cache.get(key([condition, yes, no]))!;
  }
  not(root: DecisionSet) {
    return this.ite(root, this.empty, this.all);
  }
  and(a: DecisionSet, b: DecisionSet) {
    return this.ite(a, b, this.empty);
  }
  or(a: DecisionSet, b: DecisionSet) {
    return this.ite(a, this.all, b);
  }
  xor(a: DecisionSet, b: DecisionSet) {
    return this.ite(a, this.not(b), b);
  }

  fold<T>(
    root: DecisionSet,
    terminal: (value: boolean) => T,
    combine: (variable: number, low: T, high: T) => T,
  ): T {
    this.check(root);
    const result = new Map<DecisionSet, T>([
      [0, terminal(false)],
      [1, terminal(true)],
    ]);
    const stack: { root: DecisionSet; expanded: boolean }[] = [{ root, expanded: false }];
    while (stack.length) {
      const f = stack.pop()!;
      if (result.has(f.root)) continue;
      const node = this.nodes[f.root];
      if (f.expanded)
        result.set(f.root, combine(node.variable, result.get(node.low)!, result.get(node.high)!));
      else
        stack.push(
          { ...f, expanded: true },
          { root: node.high, expanded: false },
          { root: node.low, expanded: false },
        );
    }
    return result.get(root)!;
  }
  /** Simultaneous substitution. Replacement expressions are NOT substituted
   * into each other, which is essential for a correct transition preimage. */
  compose(root: DecisionSet, replacements: ReadonlyMap<number, DecisionSet>): DecisionSet {
    for (const [variable, value] of replacements) {
      this.index(variable);
      this.check(value);
    }
    return this.fold(
      root,
      (value) => Number(value),
      (variable, low, high) =>
        this.ite(replacements.get(variable) ?? this.variable(variable), high, low),
    );
  }
  exists(root: DecisionSet, variables: Iterable<number>): DecisionSet {
    const hidden = new Set(variables);
    for (const v of hidden) this.index(v);
    return this.fold(
      root,
      (value) => Number(value),
      (variable, low, high) =>
        hidden.has(variable) ? this.or(low, high) : this.make(variable, low, high),
    );
  }
  import(root: DecisionSet, source: DecisionSets): DecisionSet {
    if (source === this) {
      this.check(root);
      return root;
    }
    return source.fold(
      root,
      (value) => Number(value),
      (variable, low, high) => this.ite(this.variable(variable), high, low),
    );
  }
  /** ∃next. relation(current,action,next) ∧ target(next). */
  preimage(relation: DecisionSet, target: DecisionSet, next: Iterable<number>) {
    return this.andExists(relation, target, next);
  }
  /** Fused relational product: quantifies during conjunction instead of first
   * constructing the potentially much larger unquantified intersection. */
  andExists(a: DecisionSet, b: DecisionSet, variables: Iterable<number>): DecisionSet {
    this.check(a);
    this.check(b);
    const hidden = new Set(variables);
    for (const v of hidden) this.index(v);
    const memo = new Map<string, DecisionSet>();
    const pair = (x: number, y: number): [number, number] => (x <= y ? [x, y] : [y, x]);
    const key = (p: [number, number]) => p.join('/');
    const stack = [{ pair: pair(a, b), expanded: false }];
    let work = 0;
    while (stack.length) {
      if (++work > (this.limits.work ?? 2_000_000)) throw new DecisionSetLimit();
      const f = stack.pop()!,
        [x, y] = f.pair,
        k = key(f.pair);
      if (memo.has(k)) continue;
      if (x === 0 || y < 2) {
        memo.set(k, x === 0 ? 0 : y);
        continue;
      }
      const variable = this.ordering.first(this.nodes[x].variable, this.nodes[y].variable);
      const at = (r: number, high: boolean) =>
        this.nodes[r].variable === variable ? this.nodes[r][high ? 'high' : 'low'] : r;
      const lo = pair(at(x, false), at(y, false)),
        hi = pair(at(x, true), at(y, true));
      if (f.expanded) {
        const low = memo.get(key(lo))!,
          high = memo.get(key(hi))!;
        memo.set(k, hidden.has(variable) ? this.or(low, high) : this.make(variable, low, high));
      } else
        stack.push(
          { ...f, expanded: true },
          { pair: hi, expanded: false },
          { pair: lo, expanded: false },
        );
    }
    return memo.get(key(pair(a, b)))!;
  }
  support(root: DecisionSet): Set<number> {
    this.check(root);
    const seen = new Set<number>(),
      variables = new Set<number>(),
      stack = [root];
    while (stack.length) {
      const at = stack.pop()!;
      if (at < 2 || seen.has(at)) continue;
      seen.add(at);
      const node = this.nodes[at];
      variables.add(node.variable);
      stack.push(node.low, node.high);
    }
    return variables;
  }
  /** ∃hidden. target ∧ R1 ∧ ... ∧ Rn, with last-use elimination.
   * Factors should follow the physical backward dependency order. The result is
   * exact for ANY factor order; the largest live separator controls its cost.
   * No Cartesian product of trajectories/assignments is materialised. */
  projectRelation(
    factors: readonly DecisionSet[],
    target: DecisionSet,
    variables: Iterable<number>,
  ) {
    const hidden = new Set(variables);
    for (const v of hidden) this.index(v);
    const supports = factors.map((f) => this.support(f));
    const remaining = new Map<number, number>();
    for (const support of supports)
      for (const v of support) remaining.set(v, (remaining.get(v) ?? 0) + 1);
    let result = this.exists(
      target,
      [...hidden].filter((v) => !remaining.has(v)),
    );
    for (const [i, factor] of factors.entries()) {
      const eliminate: number[] = [];
      for (const v of supports[i]) {
        const left = remaining.get(v)! - 1;
        remaining.set(v, left);
        if (left === 0 && hidden.has(v)) eliminate.push(v);
      }
      result = this.andExists(result, factor, eliminate);
      if (result === this.empty) return result;
    }
    return result;
  }
  evaluate(root: DecisionSet, assignment: (variable: number) => boolean): boolean {
    this.check(root);
    while (root > 1) {
      const node = this.nodes[root];
      root = assignment(node.variable) ? node.high : node.low;
    }
    return root === this.all;
  }
  /** One satisfying assignment, without listing the represented assignments.
   * Unused variables are false. The caller supplies the full variable universe. */
  pick(root: DecisionSet, variables: Iterable<number>): Map<number, boolean> | undefined {
    this.check(root);
    const result = new Map<number, boolean>();
    for (const v of variables) {
      this.index(v);
      result.set(v, false);
    }
    if (root === this.empty) return;
    while (root > 1) {
      const n = this.nodes[root];
      if (!result.has(n.variable)) throw Error('Assignment universe omits a used variable.');
      const high = n.low === this.empty;
      result.set(n.variable, high);
      root = high ? n.high : n.low;
    }
    return result;
  }
  /** Number of assignments including don't-care variables. No model list. */
  count(root: DecisionSet, variables: Iterable<number>): bigint {
    this.check(root);
    const order = [...new Set(variables)].sort(this.ordering.compare);
    for (const v of order) this.index(v);
    const ranks = new Map(order.map((v, i) => [v, i]));
    const rank = (r: DecisionSet) => {
      if (r < 2) return order.length;
      const at = ranks.get(this.nodes[r].variable);
      if (at === undefined) throw Error('Counting universe omits a used variable.');
      return at;
    };
    const counts = new Map<DecisionSet, bigint>([
      [0, 0n],
      [1, 1n],
    ]);
    const stack = [{ root, expanded: false }];
    while (stack.length) {
      const f = stack.pop()!;
      if (counts.has(f.root)) continue;
      const n = this.nodes[f.root];
      if (f.expanded) {
        const gap = (c: number) => 1n << BigInt(rank(c) - rank(f.root) - 1);
        counts.set(f.root, gap(n.low) * counts.get(n.low)! + gap(n.high) * counts.get(n.high)!);
      } else
        stack.push(
          { ...f, expanded: true },
          { root: n.high, expanded: false },
          { root: n.low, expanded: false },
        );
    }
    return (1n << BigInt(rank(root))) * counts.get(root)!;
  }
}
