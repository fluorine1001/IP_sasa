import type { Stage } from '../world/types';
import type { Condition } from '../world/conditions';
import { landingSpeedCondition } from '../world/landing';
import { compileMarker } from './goal-marker';
import { conditionKey } from './mission-intent';

/** Shared load migration, never stage-ID exceptions. Precision mode opts out.
 * Stored contact SPEED observations remain actual speeds; only acceptance rules
 * change to the visible normal/tangent landing envelope. */
export function upgradeLandingRules(source: Stage): Stage {
  if (source.rules?.landingMode === 'precision' || !Array.isArray(source.goals)) return source;
  let upgradingOld = false;
  const hasSpeed = (c: Condition): boolean =>
    c.kind === 'compare'
      ? c.left.kind === 'metric' &&
        c.left.metric === 'touchdownSpeed' &&
        c.operator === 'lte' &&
        c.right.kind === 'constant' &&
        c.right.value > 0
      : 'children' in c
        ? c.children.some(hasSpeed)
        : 'child' in c
          ? hasSpeed(c.child)
          : c.kind === 'capture'
            ? hasSpeed(c.when)
            : false;
  if (!source.goals.some((g) => hasSpeed(g.condition))) return source;
  const stage = structuredClone(source);
  function walk(c: Condition): Condition {
    if (
      c.kind === 'compare' &&
      c.left.kind === 'metric' &&
      c.left.metric === 'touchdownSpeed' &&
      c.operator === 'lte' &&
      c.right.kind === 'constant' &&
      c.right.value > 0
    )
      return landingSpeedCondition(stage, c.right.value, c.left.actorId);
    if (
      upgradingOld &&
      c.kind === 'compare' &&
      c.left.kind === 'metric' &&
      c.left.metric === 'touchdownTilt' &&
      c.operator === 'lte' &&
      c.right.kind === 'constant' &&
      c.right.value >= 0
    )
      return {
        ...c,
        right: { kind: 'constant', value: Math.min(Math.PI / 2, c.right.value + Math.PI / 12) },
      };
    if ('children' in c) return { ...c, children: c.children.map(walk) };
    if ('child' in c) return { ...c, child: walk(c.child) };
    if (c.kind === 'capture') return { ...c, when: walk(c.when) };
    return c;
  }
  for (const goal of stage.goals) {
    const before = conditionKey(goal.condition);
    upgradingOld = hasSpeed(goal.condition);
    goal.condition = walk(goal.condition);
    if (
      goal.marker?.kind === 'surface' &&
      goal.marker.managed !== false &&
      goal.marker.compiledKey === before
    )
      Object.assign(goal, compileMarker(stage, goal));
    if (goal.marker?.compiledKey === before) goal.marker.compiledKey = conditionKey(goal.condition);
    if (goal.sketch?.compiledKey === before) goal.sketch.compiledKey = conditionKey(goal.condition);
    if (goal.intent?.compiledKey === before) goal.intent.compiledKey = conditionKey(goal.condition);
  }
  return stage;
}
