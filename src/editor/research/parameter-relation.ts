import type { HybridAlgebra } from '../../physics/hybrid-kernel';
import { logic } from '../../physics/hybrid-kernel';
import { constantKernel } from '../../physics/constant-kernel';
import type { SearchTemplate } from '../solution-search';
import { timeCeilings } from '../parameter-bounds';

/** Lift parameterPlan's dependent time coordinates, not independent raw times.
 * Invalid fixed-time constraints become a false legality guard, never NaN
 * terms or a silently different coordinate system. Does not sort payloads. */
export function parameterRelation<T>(
  base: HybridAlgebra<T>,
  template: SearchTemplate,
  coordinates: readonly T[],
) {
  const a = constantKernel(base),
    b = logic(a),
    c = a.literal;
  const ceilings = timeCeilings(template.parameters, template.after),
    times = new Map<string, T>();
  const values = new Map<string, T>();
  let previous = c(0),
    dimension = 0,
    valid = c(1);
  for (const [at, p] of template.parameters.entries()) {
    const timed = p.key.endsWith('.time');
    let lower = c(p.min);
    if (timed) {
      let before = previous;
      if (template.after) {
        before = c(0);
        for (const key of template.after[p.key] ?? [])
          before = a.max(before, times.get(key) ?? c(0));
      }
      lower = a.max(lower, before);
    }
    const upper = c(ceilings[at]);
    const u = p.enabled ? coordinates[dimension++] : undefined;
    if (p.enabled && u === undefined) throw Error('Missing parameter coordinate.');
    const value = p.enabled ? a.add(lower, a.multiply(u!, a.subtract(upper, lower))) : c(p.value);
    if (p.enabled) valid = b.and(valid, a.lte(lower, upper));
    if (timed) {
      valid = b.and(valid, b.and(a.lte(lower, value), a.lte(value, upper)));
      previous = value;
      times.set(p.key, value);
    }
    values.set(p.key, value);
  }
  if (dimension !== coordinates.length) throw Error('Unexpected parameter coordinate count.');
  return { values, valid };
}
