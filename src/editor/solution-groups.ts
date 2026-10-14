import type { Stage, RoutePlan } from '../world/types';
import type { SolutionFamily } from './solution-search';

/** Exact controls, ignoring record IDs. Never round physical values or erase no-ops. */
export function physicalPlanKey(stage: Stage, plan: RoutePlan) {
  return JSON.stringify({
    launch: stage.rocket ? Math.hypot(plan.launch.x, plan.launch.y) : plan.launch,
    commands: (plan.engineCommands ?? []).map((c) => [
      c.time,
      c.actorId,
      c.separate ?? false,
      c.releasePayload ?? null,
      c.throttle ?? null,
      c.direction ?? null,
    ]),
    pushes: plan.impulses.map((c) => [c.time, c.vector]),
  });
}

/** Families may overlap across layouts only at an exactly identical, verified flight.
 * An unexecuted suffix is removed only after another real simulation succeeds. */
export function mergeOverlappingFamilies(stage: Stage, families: SolutionFamily[]) {
  const parent = families.map((_, i) => i),
    owners = new Map<string, number>();
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  families.forEach((family, i) => {
    for (const plan of family.samples) {
      const key = physicalPlanKey(stage, plan),
        owner = owners.get(key);
      if (owner !== undefined) parent[find(i)] = find(owner);
      else owners.set(key, i);
    }
  });
  const groups = new Map<number, SolutionFamily[]>();
  families.forEach((family, i) => {
    const id = find(i),
      group = groups.get(id) ?? [];
    group.push(family);
    groups.set(id, group);
  });
  return [...groups.values()]
    .map((group) => {
      const first = group.reduce((a, b) => (a.id <= b.id ? a : b)),
        unique = new Map<string, RoutePlan>(),
        ranges = new Map<string, { label: string; min: number; max: number; gap?: number }>();
      for (const family of group) {
        for (const plan of family.samples) unique.set(physicalPlanKey(stage, plan), plan);
        for (const range of family.ranges) {
          const prior = ranges.get(range.label);
          ranges.set(
            range.label,
            prior
              ? {
                  ...range,
                  min: Math.min(prior.min, range.min),
                  max: Math.max(prior.max, range.max),
                  gap: Math.max(prior.gap ?? 0, range.gap ?? 0),
                }
              : { ...range },
          );
        }
      }
      return {
        ...first,
        count: group.reduce((n, f) => n + f.count, 0),
        ranges: [...ranges.values()],
        samples: [...unique.values()],
        layouts: group.length,
        connections: group.reduce((n, f) => n + (f.connections ?? 0), 0),
      };
    })
    .sort((a, b) => b.count - a.count);
}
