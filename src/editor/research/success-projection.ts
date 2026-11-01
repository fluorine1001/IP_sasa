import { NonlinearRelation, type Term } from './nonlinear-relation';
import { normalize, type RealDomain } from './real-domains';
import { adjacent, type Interval } from '../interval';
import { regionalRelation } from './regional-relation';
import {
  polynomialGuards,
  polynomialGuardTruth,
  polynomialRootClusters,
  type PolynomialGuard,
  type RootCluster,
} from './polynomial-boundary';

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
  options: {
    cells?: number;
    resolution?: number;
    work?: number;
    interiorFirst?: boolean;
    taylor?: boolean;
    polynomial?: boolean;
  } = {},
): Generator<ProjectionStep> {
  const limit = options.cells ?? 256,
    resolution = options.resolution ?? 1e-5;
  if (
    (limit !== Infinity && !Number.isSafeInteger(limit)) ||
    limit <= 0 ||
    !Number.isFinite(resolution) ||
    resolution <= 0
  )
    throw Error('Invalid projection resource settings.');
  const initial = Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, normalize(v)]));
  if (Object.values(initial).some((d) => !d.length)) return;
  const queue: Record<string, RealDomain>[] = [initial];
  let interior: Record<string, RealDomain> | undefined;
  const relevant = new Set(relation.inputs([success]));
  // Algebraic mode boundaries are inverted once, not rediscovered by a grid of
  // flight samples. The isolating STRIP is retained; neither side is classified
  // from a root approximation. General/nonseparable guards remain untouched.
  const cuts = new Map<string, number[]>();
  const guards: { guard: PolynomialGuard; roots: RootCluster[] }[] = [];
  const rootCache = new Map<string, ReturnType<typeof polynomialRootClusters>>();
  const faces = new Map<string, { variable: string; value: number }>();
  if (options.polynomial !== false)
    for (const boundary of polynomialGuards(relation, [success], initial)) {
      const d = initial[boundary.variable];
      if (!d?.length) continue;
      const key = boundary.variable + ':' + boundary.coefficients.map(String).join(',');
      let roots = rootCache.get(key);
      if (!rootCache.has(key))
        roots = polynomialRootClusters(
          boundary.coefficients,
          { lo: d[0].lo, hi: d.at(-1)!.hi },
          { resolution: Math.min(resolution / 16, 1e-9), work: 256 },
        );
      rootCache.set(key, roots);
      // An identically-zero difference is handled directly; it has infinitely
      // many roots and must not masquerade as a root-free polynomial.
      if (boundary.coefficients.length === 1) guards.push({ guard: boundary, roots: [] });
      if (!roots) continue;
      if (boundary.coefficients.length > 1) guards.push({ guard: boundary, roots: roots.clusters });
      for (const root of roots.clusters) {
        const { lo, hi } = root.interval,
          faceKey = boundary.variable + ':' + lo;
        // Equality/tangency successes can have empty interior. Exact algebraic
        // faces enter the relation queue, not just the split hints.
        // Unisolated/non-dyadic strips remain in the original covering boxes.
        if (lo !== hi || faces.has(faceKey) || !d.some((p) => p.lo <= lo && lo <= p.hi)) continue;
        if (d.length === 1 && d[0].lo === lo && d[0].hi === lo) continue;
        faces.set(faceKey, { variable: boundary.variable, value: lo });
      }
      const values = cuts.get(boundary.variable) ?? [];
      for (const root of roots.clusters) values.push(root.interval.lo, root.interval.hi);
      cuts.set(
        boundary.variable,
        [...new Set(values)].sort((a, b) => a - b),
      );
    }
  const axes = [...relevant].filter((key) => {
    const d = initial[key];
    return d?.length && (d.length > 1 || d[0].lo !== d[0].hi);
  });
  // One-dimensional algebraic cell decomposition covers the WHOLE initial
  // domain at once, including all retained root strips, rather than rediscovering
  // the same polynomial boundary in a binary subdivision tree. Closed cells
  // deliberately overlap at endpoints; strict predicates still decide them.
  if (axes.length === 1) {
    const key = axes[0],
      points = cuts.get(key) ?? [];
    if (
      points.length &&
      points.length <= 128 &&
      initial[key].every((d) => Number.isFinite(d.lo) && Number.isFinite(d.hi))
    ) {
      queue.length = 0;
      for (const d of initial[key]) {
        const edges = [...new Set([d.lo, ...points.filter((v) => d.lo < v && v < d.hi), d.hi])];
        edges.sort((a, b) => a - b);
        if (edges.length === 1) queue.push({ ...initial, [key]: [d] });
        for (let i = 1; i < edges.length; i++)
          queue.push({ ...initial, [key]: [{ lo: edges[i - 1], hi: edges[i] }] });
      }
      for (const face of faces.values())
        if (face.variable === key)
          queue.push({ ...initial, [key]: [{ lo: face.value, hi: face.value }] });
    }
  }
  let cursor = 0,
    boundaries = 0,
    serial = 0;
  const statistics = { cells: 0, visits: 0, excluded: 0, pointEvaluations: 0 as const };
  const report = (accepted: ProjectionCell[] = []): ProjectionStep => ({
    accepted,
    complete: cursor === queue.length && !interior && boundaries === 0,
    pending: queue.length - cursor + Number(!!interior) + boundaries,
    statistics: { ...statistics },
  });
  while ((interior || cursor < queue.length) && statistics.cells < limit) {
    if (cursor >= 1024) {
      queue.splice(0, cursor);
      cursor = 0;
    }
    const current = interior ?? queue[cursor++];
    interior = undefined;
    statistics.cells++;
    const specialised = regionalRelation(current, { taylor: options.taylor });
    const proven = new Map<number, 0 | 1>();
    for (const { guard, roots } of guards) {
      const d = current[guard.variable];
      if (!d?.length) continue;
      const truth = polynomialGuardTruth(guard, roots, { lo: d[0].lo, hi: d.at(-1)!.hi });
      if (truth !== undefined) proven.set(guard.term.id, truth);
    }
    let [predicate] = relation.rebase([success], specialised, proven);
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
    let mid =
      lo === -Infinity
        ? hi === Infinity
          ? 0
          : hi - Math.max(1, Math.abs(hi))
        : hi === Infinity
          ? lo + Math.max(1, Math.abs(lo))
          : lo / 2 + hi / 2;
    const margin = Math.max(resolution * 0.01, (hi - lo) * 0.1);
    const algebraic = cuts.get(key)?.filter((v) => lo + margin < v && v < hi - margin);
    if (algebraic?.length)
      mid = algebraic.reduce((a, v) => (Math.abs(v - mid) < Math.abs(a - mid) ? v : a));
    if (!(lo < mid && mid < hi)) {
      boundaries++;
      yield report();
      continue;
    }
    if (options.interiorFirst && !algebraic?.length && Number.isFinite(hi - lo)) {
      // An inner BOX, never a sampled flight. Preserve both outer slabs in the
      // fair FIFO and refine the core first; this avoids spending a whole level
      // of breadth-first work before any robust region becomes provable.
      const lower = lo / 2 + mid / 2,
        upper = mid / 2 + hi / 2;
      if (lo < lower && lower < upper && upper < hi) {
        queue.push(
          { ...yes.domains, [key]: [{ lo, hi: lower }] },
          { ...yes.domains, [key]: [{ lo: upper, hi }] },
        );
        interior = { ...yes.domains, [key]: [{ lo: lower, hi: upper }] };
      }
    }
    if (!interior)
      queue.push(
        { ...yes.domains, [key]: [{ lo, hi: mid }] },
        { ...yes.domains, [key]: [{ lo: mid, hi }] },
      );
    yield report();
  }
  yield report();
}

/** Exact components of a finite CLOSED-box union. One varying coordinate uses
 * interval-union sweeping, O(n log n), instead of compiling dyadic endpoints
 * into a potentially exponential decision diagram. Higher-dimensional boxes
 * use a sweep/DSU: O(n log n + k*A), A=overlapping sweep-axis pairs. This is
 * output-sensitive, NOT a small worst-case bound for arbitrary box geometry,
 * and not a claim about missing solutions or human trajectory similarity. */
export function projectionGroups(
  cells: readonly ProjectionCell[],
  names = Object.keys(cells[0]?.bounds ?? {}),
) {
  if (!cells.length) return [];
  for (const cell of cells)
    for (const name of names) {
      const d = cell.bounds[name];
      if (!d || Number.isNaN(d.lo) || Number.isNaN(d.hi) || d.lo > d.hi)
        throw Error('Invalid projected cell.');
    }
  const axes = names.filter((name) =>
    cells.some(
      (c) =>
        c.bounds[name].lo !== cells[0].bounds[name].lo ||
        c.bounds[name].hi !== cells[0].bounds[name].hi,
    ),
  );
  const parents = cells.map((_, i) => i),
    sizes = cells.map(() => 1);
  const find = (i: number): number => {
    let root = i;
    while (parents[root] !== root) root = parents[root];
    while (parents[i] !== i) {
      const next = parents[i];
      parents[i] = root;
      i = next;
    }
    return root;
  };
  const join = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a === b) return;
    if (sizes[a] < sizes[b]) [a, b] = [b, a];
    parents[b] = a;
    sizes[a] += sizes[b];
  };
  if (!axes.length) for (let i = 1; i < cells.length; i++) join(0, i);
  else {
    const axis = axes[0],
      order = cells
        .map((_, i) => i)
        .sort((a, b) => cells[a].bounds[axis].lo - cells[b].bounds[axis].lo || a - b);
    if (axes.length === 1) {
      let previous = order[0],
        upper = cells[previous].bounds[axis].hi;
      for (const index of order.slice(1)) {
        const d = cells[index].bounds[axis];
        if (d.lo <= upper) {
          join(previous, index);
          upper = Math.max(upper, d.hi);
        } else {
          previous = index;
          upper = d.hi;
        }
      }
    } else {
      let active: number[] = [];
      for (const index of order) {
        const current = cells[index];
        active = active.filter((j) => cells[j].bounds[axis].hi >= current.bounds[axis].lo);
        for (const j of active) {
          if (find(index) === find(j)) continue;
          if (
            axes
              .slice(1)
              .every(
                (name) =>
                  cells[j].bounds[name].lo <= current.bounds[name].hi &&
                  current.bounds[name].lo <= cells[j].bounds[name].hi,
              )
          )
            join(index, j);
        }
        active.push(index);
      }
    }
  }
  const components = new Map<number, ProjectionCell[]>();
  cells.forEach((cell, i) => {
    const key = find(i),
      group = components.get(key) ?? [];
    group.push(cell);
    components.set(key, group);
  });
  return [...components.values()].map((members) => {
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
