import {
  intersection,
  root,
  times,
  squared,
  plus,
  enclosing,
  adjacent,
  point,
  type Interval,
} from '../interval';

/** Finite unions of closed real intervals. A union is not replaced by its hull:
 * excluded gaps survive subsequent propagation. These are necessary domains,
 * not proof that all cross-products of their values satisfy the relation. */
export type RealDomain = readonly Interval[];
export class DomainResourceLimit extends Error {
  constructor() {
    super('Nonlinear domain resource limit; no solved result.');
    this.name = 'DomainResourceLimit';
  }
}
export const entire = (): Interval[] => [{ lo: -Infinity, hi: Infinity }];
export function normalize(pieces: RealDomain): Interval[] {
  if (pieces.some((p) => Number.isNaN(p.lo) || Number.isNaN(p.hi))) throw Error('NaN domain.');
  const sorted = pieces
    .filter((p) => p.lo <= p.hi)
    .map((p) => ({ ...p }))
    .sort((a, b) => a.lo - b.lo);
  const result: Interval[] = [];
  for (const p of sorted) {
    const previous = result.at(-1);
    if (previous && p.lo <= previous.hi) previous.hi = Math.max(previous.hi, p.hi);
    else result.push(p);
  }
  return result;
}
export function intersect(a: RealDomain, b: RealDomain): Interval[] {
  const result: Interval[] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const p = intersection(a[i], b[j]);
    if (p.lo <= p.hi) result.push(p);
    if (a[i].hi < b[j].hi) i++;
    else j++;
  }
  return normalize(result);
}
export const equal = (a: RealDomain, b: RealDomain) =>
  a.length === b.length && a.every((p, i) => p.lo === b[i].lo && p.hi === b[i].hi);
export const negative = (a: RealDomain): Interval[] =>
  a.map((p) => ({ lo: -p.hi, hi: -p.lo })).reverse();
export function squarePreimage(a: RealDomain): Interval[] {
  const positive = normalize(
    a.filter((p) => p.hi >= 0).map((p) => root({ lo: Math.max(0, p.lo), hi: p.hi })),
  );
  return normalize([...negative(positive), ...positive]);
}
export function pairwise(
  a: RealDomain,
  b: RealDomain,
  operation: (x: Interval, y: Interval) => Interval,
): Interval[] {
  const pieces: Interval[] = [];
  for (const x of a)
    for (const y of b) {
      if (pieces.length >= 32_768) throw new DomainResourceLimit();
      pieces.push(operation(x, y));
    }
  return normalize(pieces);
}
/** Merge sorted Minkowski rows with a heap. Binary search skips all pairs whose
 * intervals are already covered, without materialising a Cartesian product.
 * Worst-case disjoint output is still output-sensitive; no gap is rounded shut. */
export function addDomains(a: RealDomain, b: RealDomain): Interval[] {
  let rows = normalize(a),
    columns = normalize(b);
  if (rows.length > columns.length) [rows, columns] = [columns, rows];
  if (!rows.length || !columns.length) return [];
  type Row = { i: number; j: number; value: Interval };
  const heap: Row[] = [],
    result: Interval[] = [];
  const push = (row: Row) => {
    let at = heap.length;
    heap.push(row);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (heap[parent].value.lo <= row.value.lo) break;
      heap[at] = heap[parent];
      at = parent;
    }
    heap[at] = row;
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].value.lo < heap[child].value.lo) child++;
        if (last.value.lo <= heap[child].value.lo) break;
        heap[at] = heap[child];
        at = child;
      }
      heap[at] = last;
    }
    return first;
  };
  rows.forEach((row, i) => push({ i, j: 0, value: plus(row, columns[0]) }));
  while (heap.length) {
    const row = pop(),
      last = result.at(-1);
    if (last && row.value.lo <= last.hi) last.hi = Math.max(last.hi, row.value.hi);
    else result.push({ ...row.value });
    if (result.length > 32_768) throw new DomainResourceLimit();
    const covered = result.at(-1)!.hi;
    if (result.length === 1 && result[0].lo === -Infinity && covered === Infinity) return result;
    let lo = row.j + 1,
      hi = columns.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (plus(rows[row.i], columns[mid]).hi <= covered) lo = mid + 1;
      else hi = mid;
    }
    if (lo < columns.length) push({ i: row.i, j: lo, value: plus(rows[row.i], columns[lo]) });
  }
  return result;
}
export const subtractDomains = (a: RealDomain, b: RealDomain) => addDomains(a, negative(b));
export const multiplyDomains = (a: RealDomain, b: RealDomain) => pairwise(a, b, times);
export const squareDomains = (a: RealDomain) => normalize(a.map(squared));
export function reciprocal(a: RealDomain): Interval[] {
  const pieces: Interval[] = [];
  for (const p of a) {
    if (p.lo < 0) pieces.push(enclosing(p.hi < 0 ? 1 / p.hi : -Infinity, 1 / p.lo));
    if (p.hi > 0) pieces.push(enclosing(1 / p.hi, p.lo > 0 ? 1 / p.lo : Infinity));
  }
  return normalize(pieces);
}
export const divideDomains = (a: RealDomain, b: RealDomain) => multiplyDomains(a, reciprocal(b));
const hasZero = (a: RealDomain) => a.some((p) => p.lo <= 0 && p.hi >= 0);
/** Solve x*b=z for x; b=z=0 leaves x unrestricted. This is not the same as
 * evaluating z/b, where b=0 is undefined in the real arithmetic relation. */
export const inverseProduct = (z: RealDomain, b: RealDomain) =>
  hasZero(z) && hasZero(b) ? entire() : divideDomains(z, b);
const cubePoint = (x: number) => times(squared(point(x)), point(x));
export const cubeDomain = (a: Interval): Interval => ({
  lo: cubePoint(a.lo).lo,
  hi: cubePoint(a.hi).hi,
});
export function cubePreimage(a: RealDomain): Interval[] {
  return normalize(
    a.map((p) => {
      let lo = Math.cbrt(p.lo),
        hi = Math.cbrt(p.hi);
      for (let i = 0; i < 16 && Number.isFinite(lo) && cubePoint(lo).hi > p.lo; i++)
        lo = adjacent(lo, false);
      for (let i = 0; i < 16 && Number.isFinite(hi) && cubePoint(hi).lo < p.hi; i++)
        hi = adjacent(hi, true);
      if (Number.isFinite(lo) && cubePoint(lo).hi > p.lo) lo = -Infinity;
      if (Number.isFinite(hi) && cubePoint(hi).lo < p.hi) hi = Infinity;
      return { lo, hi };
    }),
  );
}
export function hypotDomains(a: RealDomain, b: RealDomain): Interval[] {
  return normalize(addDomains(squareDomains(a), squareDomains(b)).map(root));
}
export const inverseHypot = (z: RealDomain, other: RealDomain) =>
  squarePreimage(
    subtractDomains(squareDomains(intersect(z, [{ lo: 0, hi: Infinity }])), squareDomains(other)),
  );
export const maxDomains = (a: RealDomain, b: RealDomain) =>
  pairwise(a, b, (x, y) => ({ lo: Math.max(x.lo, y.lo), hi: Math.max(x.hi, y.hi) }));
export function inverseMax(z: RealDomain, other: RealDomain): Interval[] {
  const overlap = intersect(z, other);
  return normalize([...z, ...(overlap.length ? [{ lo: -Infinity, hi: overlap.at(-1)!.hi }] : [])]);
}
