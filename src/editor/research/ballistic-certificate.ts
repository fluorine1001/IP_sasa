import type { Condition } from '../../world/conditions';
import type { Stage } from '../../world/types';
import { objectiveGoals } from '../../world/goals';
import { hullSize, ROCKET_RADIUS } from '../../world/hull';
import * as I from '../interval';

/** Sufficient-region elimination lemma, not a mission-name strategy. When all
 * accelerations vanish, triangle inequalities certify an entire legal control
 * tube free of contacts/world exits. Persistent clock predicates then need no
 * per-slice event-clock expansion. Unsupported predicates simply decline.
 * The caller still constrains ALL launch/impulse resources and validates native
 * representatives. Rejected controls must remain residual, not be pruned. */
export function ballisticTimeCertificate(stage: Stage, horizon: number): boolean {
  if (
    ![
      horizon,
      stage.rules.launchLimit,
      stage.rules.maneuverBudget,
      stage.rules.worldRadius,
      stage.spawn.position.x,
      stage.spawn.position.y,
      stage.spawn.velocity.x,
      stage.spawn.velocity.y,
    ].every(Number.isFinite) ||
    horizon <= 0 ||
    stage.rules.launchLimit < 0 ||
    stage.rules.maneuverBudget < 0
  )
    return false;
  if (
    stage.rocket ||
    stage.launchBodyId ||
    stage.bodies.some((b) => b.mu !== 0 || b.motion || b.dynamic || !(b.radius > 0)) ||
    stage.objects.some((o) => o.motion || o.dynamic || o.surface)
  )
    return false;
  const p = I.point,
    length = (v: { x: number; y: number }) =>
      v.x === 0 && v.y === 0 ? p(0) : I.root(I.plus(I.squared(p(v.x)), I.squared(p(v.y))));
  const speed = I.plus(
      length(stage.spawn.velocity),
      I.plus(p(stage.rules.launchLimit), p(stage.rules.maneuverBudget)),
    ),
    travel = I.times(speed, p(horizon)),
    reach = I.plus(travel, p(hullSize().length + ROCKET_RADIUS));
  if (I.plus(length(stage.spawn.position), travel).hi >= stage.rules.worldRadius) return false;
  const obstacles = [
    ...stage.bodies.filter((b) => b.kind !== 'barycenter'),
    ...stage.objects.flatMap((o) => {
      const radius =
        o.kind === 'station'
          ? (o.physicalRadius ?? 0)
          : ['satellite', 'debris'].includes(o.kind)
            ? o.radius
            : 0;
      return radius > 0 ? [{ position: o.position, radius }] : [];
    }),
  ];
  for (const o of obstacles) {
    const x = I.minus(p(stage.spawn.position.x), p(o.position.x)),
      y = I.minus(p(stage.spawn.position.y), p(o.position.y)),
      distance = I.root(I.plus(I.squared(x), I.squared(y)));
    if (distance.lo <= I.plus(reach, p(o.radius)).hi) return false;
  }
  // Only upward-closed clock formulas are absorbed here, never short windows,
  // hold/sequence/capture/event history or an arbitrary spatial goal.
  const persistent = (c: Condition): boolean => {
    if (c.kind === 'all') return c.children.every(persistent);
    if (c.kind === 'any') return c.children.some(persistent);
    if (c.kind !== 'compare') return false;
    const timeMetric = (e: typeof c.left) =>
      e.kind === 'metric' &&
      e.metric === 'time' &&
      (!e.actorId || e.actorId === 'craft') &&
      ['', 'origin'].includes(e.targetId);
    const leftTime = timeMetric(c.left),
      rightTime = timeMetric(c.right);
    const value =
      leftTime && c.right.kind === 'constant' && ['gte', 'gt'].includes(c.operator)
        ? c.right.value
        : rightTime && c.left.kind === 'constant' && ['lte', 'lt'].includes(c.operator)
          ? c.left.value
          : NaN;
    return Number.isFinite(value) && value < horizon - 1e-8;
  };
  const roots = objectiveGoals(stage);
  const eligible = roots.map(
    (g) =>
      !g.dependsOn.length &&
      g.startTime < horizon - 1e-8 &&
      (g.endTimeUnlimited || g.endTime >= horizon) &&
      persistent(g.condition),
  );
  return (
    !!roots.length && (stage.goalMode === 'all' ? eligible.every(Boolean) : eligible.some(Boolean))
  );
}
