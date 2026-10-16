import { DecisionSets, type DecisionSet } from './decision-set';

/** Connected components of a finite undirected relation, as whole BDD sets.
 * Computes relational images, NOT a walk over individual represented vertices.
 * One model is extracted per output component, not per successful assignment.
 * Cost depends on DD sizes, symbolic reachability diameter and output count;
 * neither polynomial worst-case cost nor physical-trajectory equivalence follows.
 * The caller must supply a mathematically justified adjacency relation. */
export function* symbolicComponents(
  sets: DecisionSets,
  vertices: DecisionSet,
  relation: DecisionSet,
  source: readonly number[],
  target: readonly number[],
) {
  if (source.length !== target.length || new Set([...source, ...target]).size !== source.length * 2)
    throw Error('Disjoint matching source/target variables are required.');
  const toTarget = new Map(source.map((v, i) => [v, sets.variable(target[i])]));
  const toSource = new Map(target.map((v, i) => [v, sets.variable(source[i])]));
  const left = new Set(source),
    universe = new Set([...source, ...target]);
  if (
    [...sets.support(vertices)].some((v) => !left.has(v)) ||
    [...sets.support(relation)].some((v) => !universe.has(v))
  )
    throw Error('Graph has undeclared variables.');
  const edges = sets.and(relation, sets.and(vertices, sets.compose(vertices, toTarget)));
  const swapped = sets.compose(edges, new Map([...toTarget, ...toSource]));
  if (edges !== swapped) throw Error('Connected components require a symmetric relation.');
  let remaining = vertices;
  while (remaining !== sets.empty) {
    const representative = sets.pick(remaining, source)!;
    let reached = sets.all;
    for (const [v, value] of representative)
      reached = sets.and(reached, value ? sets.variable(v) : sets.not(sets.variable(v)));
    let frontier = reached,
      iterations = 0;
    while (frontier !== sets.empty) {
      iterations++;
      const image = sets.compose(sets.andExists(edges, frontier, source), toSource);
      frontier = sets.and(image, sets.not(reached));
      reached = sets.or(reached, frontier);
    }
    remaining = sets.and(remaining, sets.not(reached));
    yield { set: reached, count: sets.count(reached, source), representative, iterations };
  }
}
