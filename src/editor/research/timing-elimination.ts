import { DecisionSets, type DecisionSet } from './decision-set';
import { WeightedDecisions, type WeightedSet, type Weight } from './weighted-decisions';

export type TimingEdge = { from: number; to: number; weight: WeightedSet };

/** Indexed heap: one entry per live vertex, no stale-entry memory accumulation.
 * Priorities change only at affected endpoints. Equal costs use stable IDs. */
class EliminationQueue {
  private heap: number[] = [];
  private positions = new Map<number, number>();
  private costs = new Map<number, number>();
  private before(a: number, b: number) {
    return (
      this.costs.get(a)! < this.costs.get(b)! || (this.costs.get(a) === this.costs.get(b) && a < b)
    );
  }
  private swap(a: number, b: number) {
    [this.heap[a], this.heap[b]] = [this.heap[b], this.heap[a]];
    this.positions.set(this.heap[a], a);
    this.positions.set(this.heap[b], b);
  }
  private up(at: number) {
    while (at) {
      const parent = (at - 1) >> 1;
      if (!this.before(this.heap[at], this.heap[parent])) break;
      this.swap(at, parent);
      at = parent;
    }
    return at;
  }
  private down(at: number) {
    while (at * 2 + 1 < this.heap.length) {
      let child = at * 2 + 1;
      if (child + 1 < this.heap.length && this.before(this.heap[child + 1], this.heap[child]))
        child++;
      if (!this.before(this.heap[child], this.heap[at])) break;
      this.swap(at, child);
      at = child;
    }
  }
  set(vertex: number, cost: number) {
    this.costs.set(vertex, cost);
    let position = this.positions.get(vertex);
    if (position === undefined) {
      position = this.heap.length;
      this.positions.set(vertex, position);
      this.heap.push(vertex);
    }
    this.down(this.up(position));
  }
  pop(): number | undefined {
    if (!this.heap.length) return;
    const result = this.heap[0],
      last = this.heap.pop()!;
    this.positions.delete(result);
    this.costs.delete(result);
    if (this.heap.length) {
      this.heap[0] = last;
      this.positions.set(last, 0);
      this.down(0);
    }
    return result;
  }
}

/** Exact existential variable elimination of conditional difference constraints.
 * For each choice, eliminating clock v replaces in(u,v)+out(v,w) by the tightest
 * u->w bound. A negative self-loop forbids exactly that choice; nonnegative
 * self-loops cannot improve any path. Strict bounds use infinitesimal weights.
 * Induction on removed clocks proves preservation of ALL feasible assignments.
 *
 * Unlike V Bellman–Ford rounds, only actual separator pairs are composed:
 * P=sum_v inDegree(v)*outDegree(v), with no choice/time-point enumeration.
 * Structural work O((V+E+P) log V), storage O(V+E+fill), PLUS DD operation and
 * exact BigInt costs (which can still be exponential for general inputs).
 * This is a timing theory, NOT general nonlinear rocket physics. */
export function eliminateTimings(
  sets: DecisionSets,
  weights: WeightedDecisions,
  members: readonly number[],
  edges: readonly TimingEdge[],
  allowed: DecisionSet,
) {
  const incoming = new Map(members.map((v) => [v, new Map<number, WeightedSet>()]));
  const outgoing = new Map(members.map((v) => [v, new Map<number, WeightedSet>()]));
  const queue = new EliminationQueue();
  const proof: { vertex: number; ins: Map<number, WeightedSet>; outs: Map<number, WeightedSet> }[] =
    [];
  let choices = allowed,
    products = 0,
    fill = 0,
    arcs = 0,
    peakArcs = 0,
    separator = 0,
    removed = 0;
  const reject = (weight: WeightedSet) => {
    choices = sets.and(choices, sets.not(weights.negative(weight, sets)));
  };
  for (const e of edges) {
    if (e.from === e.to) {
      reject(e.weight);
      continue;
    }
    const old = outgoing.get(e.from)!.get(e.to);
    const weight = old ? weights.min(old, e.weight) : e.weight;
    outgoing.get(e.from)!.set(e.to, weight);
    incoming.get(e.to)!.set(e.from, weight);
    if (!old) arcs++;
  }
  peakArcs = arcs;
  const update = (v: number) => queue.set(v, incoming.get(v)!.size * outgoing.get(v)!.size);
  for (const v of members) update(v);
  for (;;) {
    if (choices === sets.empty) break;
    const v = queue.pop();
    if (v === undefined) break;
    removed++;
    const ins = incoming.get(v)!,
      outs = outgoing.get(v)!;
    proof.push({ vertex: v, ins, outs });
    const affected = new Set([...ins.keys(), ...outs.keys()]);
    separator = Math.max(separator, affected.size);
    for (const [from, left] of ins)
      for (const [to, right] of outs) {
        products++;
        const candidate = weights.add(left, right);
        if (!candidate.node) continue;
        if (from === to) {
          reject(candidate);
          continue;
        }
        const old = outgoing.get(from)!.get(to);
        const weight = old ? weights.min(old, candidate) : candidate;
        outgoing.get(from)!.set(to, weight);
        incoming.get(to)!.set(from, weight);
        if (!old) {
          arcs++;
          fill++;
        }
      }
    peakArcs = Math.max(peakArcs, arcs);
    for (const from of ins.keys()) {
      outgoing.get(from)!.delete(v);
      arcs--;
    }
    for (const to of outs.keys()) {
      incoming.get(to)!.delete(v);
      arcs--;
    }
    incoming.delete(v);
    outgoing.delete(v);
    for (const other of affected) update(other);
  }
  return {
    choices,
    statistics: { products, fill, peakArcs, separator, removed },
    /** Back-substitution in the same existential-elimination proof. No second
     * shortest-path solve. Infinite (inactive) branches impose no bound. */
    potentials(
      assignment: (variable: number) => boolean,
      work: { bounds: number },
      evaluate = weights.evaluator(assignment),
    ) {
      if (!sets.evaluate(choices, assignment) || proof.length !== members.length)
        throw Error('Cannot reconstruct an infeasible timing.');
      const values = new Map<number, Weight>();
      const less = (a: Weight, b: Weight) => a.n < b.n || (a.n === b.n && a.e < b.e);
      for (let i = proof.length - 1; i >= 0; i--) {
        const step = proof[i];
        let lower: Weight | undefined, upper: Weight | undefined;
        for (const [from, bound] of step.ins) {
          work.bounds++;
          const w = evaluate(bound);
          if (!w) continue;
          const p = values.get(from)!,
            candidate = { n: p.n + w.n, e: p.e + w.e };
          if (!upper || less(candidate, upper)) upper = candidate;
        }
        for (const [to, bound] of step.outs) {
          work.bounds++;
          const w = evaluate(bound);
          if (!w) continue;
          const p = values.get(to)!,
            candidate = { n: p.n - w.n, e: p.e - w.e };
          if (!lower || less(lower, candidate)) lower = candidate;
        }
        if (lower && upper && less(upper, lower)) throw Error('Invalid timing-elimination proof.');
        values.set(step.vertex, lower ?? upper ?? { n: 0n, e: 0n });
      }
      return values;
    },
  };
}
