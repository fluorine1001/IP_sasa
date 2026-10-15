import { NonlinearRelation, type Term } from './nonlinear-relation';
import { normalize, type RealDomain } from './real-domains';
import { adjacent, type Interval } from '../interval';
import { DecisionSets } from './decision-set';
import { timingComponents } from './timing-components';
import type { TimingConstraint } from './timed-choices';
import { regionalRelation } from './regional-relation';

export type ProjectionCell = { id: number; bounds: Readonly<Record<string, Interval>> };
export type ProjectionStep = {
  /** Delta only: no O(N²) snapshots of all previous accepted cells. */
  accepted: ProjectionCell[];
  complete: boolean;
  pending: number;
  statistics: { cells: number; visits: number; excluded: number; pointEvaluations: 0 };
};
/** Set inversion for a Boolean success DAG whose only free inputs are controls.
 * Its SSA physics/history states are already substituted, not independent free
 * witnesses. Contracts success and its complement; ONLY an empty complement
 * certifies an entire cell. The complement's enclosure also certifies all
 * outside slabs at once; only their remaining core needs further processing.
 * No point samples or failed-corner exclusions.
 * Exhaustion/resolution leaves pending cells and can never certify completion.
 * Real-DAG guarantees do NOT certify every IEEE game rounding boundary. */
export function* successProjection(
  relation: NonlinearRelation,
  success: Term,
  bounds: Readonly<Record<string, RealDomain>>,
  options: { cells?: number; resolution?: number; work?: number } = {},
): Generator<ProjectionStep> {
  const limit = options.cells ?? 256,
    resolution = options.resolution ?? 1e-5;
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isFinite(resolution) || resolution <= 0)
    throw Error('Invalid projection resource settings.');
  const initial = Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, normalize(v)]));
  if (Object.values(initial).some((d) => !d.length)) return;
  const queue: Record<string, RealDomain>[] = [initial];
  const relevant = new Set(relation.inputs([success]));
  let cursor = 0,
    boundaries = 0,
    serial = 0;
  const statistics = { cells: 0, visits: 0, excluded: 0, pointEvaluations: 0 as const };
  const report = (accepted: ProjectionCell[] = []): ProjectionStep => ({
    accepted,
    complete: cursor === queue.length && boundaries === 0,
    pending: queue.length - cursor + boundaries,
    statistics: { ...statistics },
  });
  while (cursor < queue.length && statistics.cells < limit) {
    if (cursor >= 1024) {
      queue.splice(0, cursor);
      cursor = 0;
    }
    const current = queue[cursor++];
    statistics.cells++;
    const specialised = regionalRelation(current);
    let [predicate] = relation.rebase([success], specialised);
    const enclosure = specialised.enclosure(predicate);
    if (
      enclosure.defined &&
      enclosure.range.lo === enclosure.range.hi &&
      (enclosure.range.lo === 0 || enclosure.range.lo === 1)
    )
      predicate = specialised.literal(enclosure.range.lo);
    const yes = specialised.contract(current, [{ term: predicate, range: [{ lo: 1, hi: 1 }] }], {
      work: options.work ?? 8192,
    });
    statistics.visits += yes.statistics.visits;
    if (yes.empty) {
      statistics.excluded++;
      yield report();
      continue;
    }
    const splitUnion = Object.entries(yes.domains).find(([, d]) => d.length > 1);
    if (splitUnion) {
      const [key, pieces] = splitUnion;
      for (const piece of pieces) queue.push({ ...yes.domains, [key]: [piece] });
      yield report();
      continue;
    }
    const no = specialised.contract(yes.domains, [{ term: predicate, range: [{ lo: 0, hi: 0 }] }], {
      work: options.work ?? 8192,
    });
    statistics.visits += no.statistics.visits;
    if (no.empty && enclosure.defined) {
      yield report([
        {
          id: serial++,
          bounds: Object.fromEntries(Object.entries(yes.domains).map(([k, d]) => [k, { ...d[0] }])),
        },
      ]);
      continue;
    }
    if (!no.empty && enclosure.defined) {
      // Separator peeling: every failure lies in the complement contractor's
      // box. Its outside slabs are therefore successful without any flights.
      // Use adjacent CLOSED endpoints, retaining the whole real boundary strip
      // in the core. Moving straight to the complement endpoint would lose the
      // open real strip or incorrectly include a strict-comparison boundary.
      const core = { ...yes.domains },
        accepted: ProjectionCell[] = [];
      const accept = (key: string, interval: Interval) =>
        accepted.push({
          id: serial++,
          bounds: Object.fromEntries(
            Object.entries(core).map(([k, d]) => [k, k === key ? interval : { ...d[0] }]),
          ),
        });
      for (const [key, domain] of Object.entries(no.domains)) {
        if (!relevant.has(key) || !domain.length) continue;
        const lower = adjacent(domain[0].lo, false),
          upper = adjacent(domain.at(-1)!.hi, true);
        let [d] = core[key];
        if (d.lo < lower && lower < d.hi) {
          accept(key, { lo: d.lo, hi: lower });
          core[key] = [{ lo: lower, hi: d.hi }];
        }
        [d] = core[key];
        if (d.lo < upper && upper < d.hi) {
          accept(key, { lo: upper, hi: d.hi });
          core[key] = [{ lo: d.lo, hi: upper }];
        }
      }
      if (accepted.length) {
        queue.push(core);
        yield report(accepted);
        continue;
      }
    }
    let split: { key: string; lo: number; hi: number; rank: number } | undefined;
    for (const [key, [d]] of Object.entries(yes.domains)) {
      if (!relevant.has(key)) continue;
      const scale = Math.max(
          1,
          Number.isFinite(d.lo) ? Math.abs(d.lo) : 1,
          Number.isFinite(d.hi) ? Math.abs(d.hi) : 1,
        ),
        width = d.hi - d.lo;
      if (!(width > resolution * scale)) continue;
      const rank = Number.isFinite(width) ? width / scale : Infinity;
      if (!split || rank > split.rank) split = { key, lo: d.lo, hi: d.hi, rank };
    }
    if (!split) {
      boundaries++;
      yield report();
      continue;
    }
    const { key, lo, hi } = split;
    const mid =
      lo === -Infinity
        ? hi === Infinity
          ? 0
          : hi - Math.max(1, Math.abs(hi))
        : hi === Infinity
          ? lo + Math.max(1, Math.abs(lo))
          : lo / 2 + hi / 2;
    if (!(lo < mid && mid < hi)) {
      boundaries++;
      yield report();
      continue;
    }
    queue.push(
      { ...yes.domains, [key]: [{ lo, hi: mid }] },
      { ...yes.domains, [key]: [{ lo: mid, hi }] },
    );
    yield report();
  }
  yield report();
}

/** Exact connected components of the finite union of certified CLOSED boxes.
 * A symbolic contact relation replaces all-pairs numeric sampling. This is not
 * a claim about missing boundary cells or trajectory-style equivalence. */
export function projectionGroups(
  cells: readonly ProjectionCell[],
  names = Object.keys(cells[0]?.bounds ?? {}),
) {
  if (!cells.length) return [];
  const sets = new DecisionSets(),
    bits = Math.max(1, Math.ceil(Math.log2(cells.length))),
    constraints: TimingConstraint[] = [];
  let allowed = sets.empty;
  const labels = cells.map((cell, i) => {
    let label = sets.all;
    for (let b = 0; b < bits; b++)
      label = sets.and(
        label,
        Math.floor(i / 2 ** b) % 2 ? sets.variable(b) : sets.not(sets.variable(b)),
      );
    allowed = sets.or(allowed, label);
    for (const name of names) {
      const d = cell.bounds[name];
      if (!d || Number.isNaN(d.lo) || Number.isNaN(d.hi) || d.lo > d.hi)
        throw Error('Invalid projected cell.');
      if (d.hi !== Infinity)
        constraints.push({ left: name, right: '$zero', upper: d.hi, when: label });
      if (d.lo !== -Infinity)
        constraints.push({ left: '$zero', right: name, upper: -d.lo, when: label });
    }
    return label;
  });
  const graph = timingComponents(sets, names, constraints, allowed);
  return [...graph.groups()].map((g) => {
    const members = cells.filter(
      (_, i) => graph.sets.and(graph.sets.import(labels[i], sets), g.set) !== graph.sets.empty,
    );
    const representative = members[0];
    return {
      cells: members,
      representative,
      point: Object.fromEntries(
        Object.entries(representative.bounds).map(([k, d]) => [
          k,
          d.lo === -Infinity
            ? d.hi === Infinity
              ? 0
              : Math.min(0, d.hi)
            : d.hi === Infinity
              ? Math.max(0, d.lo)
              : d.lo / 2 + d.hi / 2,
        ]),
      ),
    };
  });
}
