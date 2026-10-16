import { DecisionSets, type DecisionSet } from './decision-set';
import { WeightedDecisions, type WeightedSet, type Weight } from './weighted-decisions';
import { dyadic, type Dyadic } from './time-zone';
import { eliminateTimings } from './timing-elimination';

export type TimingConstraint = {
  left: string;
  right: string;
  upper: number;
  strict?: boolean;
  when?: DecisionSet;
};
type Edge = { from: number; to: number; weight: WeightedSet };
const less = (a: Weight, b: Weight) => a.n < b.n || (a.n === b.n && a.e < b.e);
const plus = (a: Weight, b: Weight): Weight => ({ n: a.n + b.n, e: a.e + b.e });

/** Exact mixed Boolean/difference-logic research backend.
 * SCC decomposition removes all acyclic timing implications from the decision
 * problem. Sparse elimination inside each remaining SCC computes every
 * infeasible Boolean assignment at once, with edge-valued decision diagrams.
 * Symbolic Bellman-Ford is retained only for independent differential research.
 * The original guarded factors retain ALL continuous solutions, not just the
 * returned witness. This is NOT yet the nonlinear rocket/goal compiler. */
export function timedChoices(
  inputSets: DecisionSets,
  clocks: readonly string[],
  constraints: readonly TimingConstraint[],
  allowed = inputSets.all,
  options: { method?: 'elimination' | 'bellman-ford'; order?: 'impact' | 'input' } = {},
) {
  if (clocks.includes('$zero') || new Set(clocks).size !== clocks.length)
    throw Error('Invalid clocks.');
  // High-impact choices first avoid exponentially many saturated low-bit
  // remainders in min-plus operations. This is representation ordering ONLY:
  // no candidate is discarded, and IDs retain their original meaning.
  const impacts = new Map<number, number>(),
    supports = new Map<DecisionSet, Set<number>>();
  const support = (root: DecisionSet) => {
    let result = supports.get(root);
    if (!result) supports.set(root, (result = inputSets.support(root)));
    return result;
  };
  for (const v of support(allowed)) impacts.set(v, 0);
  for (const c of constraints) {
    if (Number.isNaN(c.upper)) throw Error('Invalid timing constant.');
    for (const v of support(c.when ?? inputSets.all))
      impacts.set(v, Math.max(impacts.get(v) ?? 0, Math.abs(c.upper)));
  }
  const variableOrder = [...impacts.keys()].sort(
    options.order === 'input'
      ? inputSets.ordering.compare
      : (a, b) =>
          impacts.get(a) === impacts.get(b) ? a - b : impacts.get(a)! > impacts.get(b)! ? -1 : 1,
  );
  const sets = new DecisionSets({ order: variableOrder }),
    imported = new Map<DecisionSet, DecisionSet>();
  const transfer = (root: DecisionSet) => {
    let result = imported.get(root);
    if (result === undefined) imported.set(root, (result = sets.import(root, inputSets)));
    return result;
  };
  const clauses = constraints.map((c) => ({ ...c, when: transfer(c.when ?? inputSets.all) }));
  const names = ['$zero', ...clocks],
    indexes = new Map(names.map((n, i) => [n, i]));
  const at = (name: string) => {
    const i = indexes.get(name);
    if (i === undefined) throw Error('Unknown clock: ' + name);
    return i;
  };
  let scale = 0,
    choices = transfer(allowed);
  for (const c of clauses) {
    at(c.left);
    at(c.right);
    if (Number.isNaN(c.upper)) throw Error('Invalid timing constant.');
    if (c.upper === -Infinity) choices = sets.and(choices, sets.not(c.when ?? sets.all));
    if (Number.isFinite(c.upper) && c.upper !== 0)
      scale = Math.min(scale, dyadic(c.upper).exponent);
  }
  const weights = new WeightedDecisions({ order: sets.ordering }),
    combined = new Map<string, Edge>();
  for (const c of clauses) {
    if (!Number.isFinite(c.upper)) continue;
    const value = dyadic(c.upper),
      n = value.n << BigInt(Math.max(0, value.exponent - scale));
    const from = at(c.right),
      to = at(c.left),
      key = `${from}/${to}`;
    const weight = weights.choose(
      sets,
      sets.and(choices, c.when ?? sets.all),
      weights.constant(n, c.strict),
    );
    const old = combined.get(key);
    combined.set(key, { from, to, weight: old ? weights.min(old.weight, weight) : weight });
  }
  const edges = [...combined.values()].filter((e) => e.weight.node !== 0);
  const outgoing = names.map(() => [] as number[]),
    incoming = names.map(() => [] as number[]);
  for (const e of edges) {
    outgoing[e.from].push(e.to);
    incoming[e.to].push(e.from);
  }
  // Iterative Kosaraju. Guarded edges form an overgraph; every actual negative
  // cycle belongs to one of its SCCs, regardless of the control assignment.
  const seen = new Set<number>(),
    order: number[] = [];
  for (let i = 0; i < names.length; i++) {
    if (seen.has(i)) continue;
    seen.add(i);
    const stack = [{ vertex: i, child: 0 }];
    while (stack.length) {
      const f = stack.at(-1)!;
      if (f.child === outgoing[f.vertex].length) {
        order.push(f.vertex);
        stack.pop();
        continue;
      }
      const next = outgoing[f.vertex][f.child++];
      if (!seen.has(next)) {
        seen.add(next);
        stack.push({ vertex: next, child: 0 });
      }
    }
  }
  const component = names.map(() => -1),
    groups: number[][] = [];
  for (const start of order.reverse()) {
    if (component[start] !== -1) continue;
    const id = groups.length,
      members: number[] = [],
      stack = [start];
    component[start] = id;
    while (stack.length) {
      const v = stack.pop()!;
      members.push(v);
      for (const next of incoming[v])
        if (component[next] === -1) {
          component[next] = id;
          stack.push(next);
        }
    }
    groups.push(members);
  }
  const internal = groups.map(() => [] as Edge[]),
    between = groups.map(() => [] as Edge[]);
  for (const e of edges)
    if (component[e.from] === component[e.to]) internal[component[e.from]].push(e);
    else between[component[e.from]].push(e);
  let symbolicRelaxations = 0,
    rounds = 0,
    cyclicComponents = 0;
  const elimination = { products: 0, fill: 0, peakArcs: 0, separator: 0, removed: 0 };
  const proofs: (ReturnType<typeof eliminateTimings>['potentials'] | undefined)[] = [];
  for (const [id, members] of groups.entries()) {
    if (!internal[id].length || choices === sets.empty) continue;
    cyclicComponents++;
    if (options.method !== 'bellman-ford') {
      const result = eliminateTimings(sets, weights, members, internal[id], choices);
      proofs[id] = result.potentials;
      choices = result.choices;
      elimination.products += result.statistics.products;
      elimination.fill += result.statistics.fill;
      elimination.removed += result.statistics.removed;
      elimination.peakArcs = Math.max(elimination.peakArcs, result.statistics.peakArcs);
      elimination.separator = Math.max(elimination.separator, result.statistics.separator);
      continue;
    }
    const local = new Map(members.map((v, i) => [v, i]));
    let distances = members.map(() => weights.constant(0n));
    for (let round = 0; round < members.length; round++) {
      rounds++;
      const next = distances.slice();
      for (const e of internal[id]) {
        const from = local.get(e.from)!,
          to = local.get(e.to)!;
        next[to] = weights.min(next[to], weights.add(distances[from], e.weight));
        symbolicRelaxations++;
      }
      const changed = next.map(
        (r, i) =>
          r.node !== distances[i].node ||
          r.offset.n !== distances[i].offset.n ||
          r.offset.e !== distances[i].offset.e,
      );
      if (!changed.some(Boolean)) break;
      if (round === members.length - 1) {
        let bad = sets.empty;
        for (let i = 0; i < members.length; i++)
          if (changed[i]) bad = sets.or(bad, weights.less(next[i], distances[i], sets));
        choices = sets.and(choices, sets.not(bad));
      }
      distances = next;
    }
  }
  const selected = (
    assignment: (variable: number) => boolean,
    evaluate = weights.evaluator(assignment),
  ) =>
    edges.flatMap((e) => {
      const weight = evaluate(e.weight);
      return weight ? [{ ...e, value: weight }] : [];
    });
  const witnessWork = { bounds: 0, betweenComponents: 0, rounds: 0, decisionNodes: 0 };
  return {
    sets,
    choices,
    statistics: {
      variableOrder,
      elimination,
      witness: witnessWork,
      clocks: clocks.length,
      edges: edges.length,
      components: groups.length,
      cyclicComponents,
      rounds,
      symbolicRelaxations,
      weights: weights.statistics,
    },
    contains(
      assignment: (variable: number) => boolean,
      values: Readonly<Record<string, number | Dyadic>>,
    ) {
      if (!sets.evaluate(choices, assignment)) return false;
      const points = names.map((name) => {
        if (name === '$zero') return dyadic(0);
        const value = values[name];
        return typeof value === 'number' ? dyadic(value) : value;
      });
      if (points.some((p) => !p || typeof p.n !== 'bigint' || !Number.isSafeInteger(p.exponent)))
        throw Error('All clock values are required.');
      const exponent = points.reduce((s, p) => (p.n ? Math.min(s, p.exponent) : s), scale);
      const units = points.map((p) => p.n << BigInt(Math.max(0, p.exponent - exponent))),
        shift = BigInt(scale - exponent);
      return selected(assignment).every((e) => {
        const difference = units[e.to] - units[e.from],
          upper = e.value.n << shift;
        return difference < upper || (difference === upper && e.value.e >= 0n);
      });
    },
    /** Extract one exact dyadic timing only on demand. This is not a per-choice
     * loop in the all-solution computation, and is never rounded into a plan. */
    witness(assignment: (variable: number) => boolean): Record<string, Dyadic> {
      if (!sets.evaluate(choices, assignment))
        throw Error('The selected choice has no feasible timing.');
      witnessWork.bounds =
        witnessWork.betweenComponents =
        witnessWork.rounds =
        witnessWork.decisionNodes =
          0;
      const evaluate = weights.evaluator(assignment, witnessWork),
        active = selected(assignment, evaluate);
      let distances: Weight[] = names.map(() => ({ n: 0n, e: 0n }));
      if (options.method !== 'bellman-ford') {
        for (const proof of proofs)
          if (proof)
            for (const [v, potential] of proof(assignment, witnessWork, evaluate))
              distances[v] = potential;
        const offsets: Weight[] = groups.map(() => ({ n: 0n, e: 0n }));
        // Kosaraju produced topological SCC order. A single DAG pass joins all
        // component-local potentials; translations preserve their inner bounds.
        for (const [id, outgoing] of between.entries())
          for (const edge of outgoing) {
            witnessWork.betweenComponents++;
            const w = evaluate(edge.weight);
            if (!w) continue;
            const a = plus(distances[edge.from], offsets[id]),
              b = distances[edge.to];
            const candidate = { n: a.n + w.n - b.n, e: a.e + w.e - b.e };
            if (less(candidate, offsets[component[edge.to]]))
              offsets[component[edge.to]] = candidate;
          }
        distances = distances.map((d, v) => plus(d, offsets[component[v]]));
      } else {
        for (let round = 0; round < names.length; round++) {
          witnessWork.rounds++;
          const next = distances.slice();
          let changed = false;
          for (const e of active) {
            witnessWork.bounds++;
            const candidate = plus(distances[e.from], e.value);
            if (less(candidate, next[e.to])) {
              next[e.to] = candidate;
              changed = true;
            }
          }
          distances = next;
          if (!changed) break;
          if (round === names.length - 1) throw Error('Symbolic timing contradiction.');
        }
      }
      let epsilonBound = 1n;
      for (const e of active) {
        const value = distances[e.to].e - distances[e.from].e - e.value.e;
        const magnitude = value < 0n ? -value : value;
        if (magnitude + 1n > epsilonBound) epsilonBound = magnitude + 1n;
      }
      const shift = BigInt(epsilonBound.toString(2).length + 1),
        exponent = scale - Number(shift),
        origin = distances[0];
      return Object.fromEntries(
        clocks.map((name, i) => [
          name,
          {
            n: ((distances[i + 1].n - origin.n) << shift) + distances[i + 1].e - origin.e,
            exponent,
          },
        ]),
      );
    },
  };
}
