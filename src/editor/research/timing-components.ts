import { DecisionSets, type DecisionSet } from './decision-set';
import { timedChoices, type TimingConstraint } from './timed-choices';
import { symbolicComponents } from './symbolic-components';

/** Research grouping of a finite union of real difference-constraint cells.
 * All choices MUST denote the same event payloads; only their timing constraints
 * vary. This does not decide similarity between physically different commands.
 *
 * Each feasible cell is convex. Two cells are connected when C intersects cl(D)
 * or cl(C) intersects D; mere closure/closure contact is NOT sufficient for open
 * gaps. For finite nonempty polyhedral cells this contact graph has exactly the
 * connected components of their union. Closure of a nonempty difference zone is
 * obtained by relaxing strict bounds. Empty cells are explicitly excluded first.
 * Two copies of guard bits and shared clocks compute ALL contacts symbolically,
 * instead of checking every pair of choices or sampling their boundary points.
 * This is not yet the actual nonlinear-flight success/trajectory grouping. */
export function timingComponents(
  inputSets: DecisionSets,
  clocks: readonly string[],
  constraints: readonly TimingConstraint[],
  allowed = inputSets.all,
) {
  const variables = new Set(inputSets.support(allowed));
  for (const c of constraints)
    for (const v of inputSets.support(c.when ?? inputSets.all)) variables.add(v);
  const source = [...variables].sort((a, b) => a - b),
    maximum = source.reduce((a, b) => Math.max(a, b), -1);
  if (!Number.isSafeInteger(maximum + source.length)) throw Error('No safe target variable IDs.');
  const target = source.map((_, i) => maximum + i + 1);
  const replacements = new Map(source.map((v, i) => [v, inputSets.variable(target[i])]));
  const solution = timedChoices(inputSets, clocks, constraints, allowed);
  const feasible = inputSets.import(solution.choices, solution.sets);
  const pairAllowed = inputSets.and(feasible, inputSets.compose(feasible, replacements));
  const copied = constraints.map((c) => ({
    ...c,
    strict: false,
    when: inputSets.compose(c.when ?? inputSets.all, replacements),
  }));
  const contact = timedChoices(inputSets, clocks, [...constraints, ...copied], pairAllowed);
  const sets = contact.sets;
  const swap = new Map<number, DecisionSet>();
  source.forEach((v, i) => {
    swap.set(v, sets.variable(target[i]));
    swap.set(target[i], sets.variable(v));
  });
  const relation = sets.or(contact.choices, sets.compose(contact.choices, swap));
  const vertices = sets.import(feasible, inputSets);
  return {
    sets,
    vertices,
    relation,
    source,
    target,
    statistics: { solution: solution.statistics, contact: contact.statistics },
    groups: () => symbolicComponents(sets, vertices, relation, source, target),
    witness: (assignment: (variable: number) => boolean) => solution.witness(assignment),
  };
}
