import type { Stage } from '../world/types';
import { compileMarker } from './goal-marker';
import { compileSketch } from './goal-sketch';
import { conditionKey } from './mission-intent';

const retired = new Set(['eccentricity', 'eccentricityX', 'eccentricityY']);
function hasRetired(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  return (
    (node.kind === 'metric' && retired.has(String(node.metric))) ||
    Object.values(node).some(hasRetired)
  );
}
/** Retire shape restrictions throughout the AST, including repeated/window margins.
 * Never replace a removed alternative by TRUE: that would make OR goals free wins.
 * A goal consisting ONLY of a retired condition is intentionally incomplete. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean).filter((v) => v !== undefined);
  if (!value || typeof value !== 'object') return value;
  const node = value as Record<string, unknown>;
  if (node.kind === 'metric' && retired.has(String(node.metric))) return undefined;
  const result = Object.fromEntries(
    Object.entries(node)
      .map(([k, v]) => [k, clean(v)])
      .filter(([, v]) => v !== undefined),
  );
  if (node.kind === 'calculate') {
    const before = Array.isArray(node.args) ? node.args : [],
      after = result.args as unknown[];
    if (
      !after?.length ||
      (after.length !== before.length && !['min', 'max'].includes(String(node.operation)))
    )
      return undefined;
    if (['min', 'max'].includes(String(node.operation)) && after.length === 1) return after[0];
  }
  if (node.kind === 'compare' && (!result.left || !result.right)) return undefined;
  if (node.kind === 'window' && (!result.value || !result.domain || !result.width))
    return undefined;
  if (
    ['all', 'any', 'sequence'].includes(String(node.kind)) &&
    !(result.children as unknown[])?.length
  )
    return undefined;
  if (['hold', 'once', 'not', 'quantify'].includes(String(node.kind)) && !result.child)
    return undefined;
  if (node.kind === 'capture' && (!result.value || !result.when)) return undefined;
  if (node.kind === 'raw' && !result.condition) return undefined;
  if (node.kind === 'circular') delete result.eccentricity;
  if (node.overrides && typeof node.overrides === 'object')
    delete (result.overrides as Record<string, unknown>).eccentricity;
  return result;
}
/** Global immutable compatibility migration: old file/API/offline goals use the
 * SAME geometric acceptance as new authoring. No mission-ID exceptions. */
export function upgradeVisibleOrbitBands(source: Stage): Stage {
  if (!Array.isArray(source.goals)) return source;
  const stage = clean(source) as Stage;
  stage.goals = stage.goals.map((goal, i) => {
    const previous = source.goals[i];
    goal.condition ??= { kind: 'all', children: [] };
    if (
      goal.marker &&
      previous.marker?.compiledKey &&
      previous.marker.compiledKey !== conditionKey(previous.condition)
    )
      goal.marker.managed = false;
    if (
      goal.sketch &&
      previous.sketch?.compiledKey &&
      previous.sketch.compiledKey !== conditionKey(previous.condition)
    )
      goal.sketch.managed = false;
    if (
      hasRetired(previous.condition) &&
      goal.marker?.kind === 'orbit' &&
      goal.marker.managed !== false &&
      previous.marker?.compiledKey === conditionKey(previous.condition)
    ) {
      Object.assign(goal, compileMarker(stage, goal));
    } else if (
      hasRetired(previous.condition) &&
      goal.sketch?.managed !== false &&
      goal.sketch &&
      previous.sketch?.compiledKey === conditionKey(previous.condition)
    ) {
      Object.assign(goal, compileSketch(stage, goal.sketch));
    }
    if (goal.marker) goal.marker.compiledKey = conditionKey(goal.condition);
    if (goal.sketch) goal.sketch.compiledKey = conditionKey(goal.condition);
    if (goal.intent) {
      if (
        previous.intent?.compiledKey &&
        previous.intent.compiledKey !== conditionKey(previous.condition)
      )
        goal.intent.managed = false;
      goal.intent.compiledKey = conditionKey(goal.condition);
    }
    // Bare old generated band goals acquire metadata without changing remaining criteria.
    if (
      !goal.outcome &&
      goal.display &&
      previous.title === '목표 띠에서 거의 원형인 궤도를 한 바퀴 유지'
    ) {
      goal.title = '표시된 궤도 띠에서 한 바퀴';
    }
    if (goal.outcome?.kind === 'circular') {
      // Preserve custom predicates; only remove the retired metadata field above.
      delete goal.outcome.eccentricity;
    }
    return goal;
  });
  return JSON.stringify(stage) === JSON.stringify(source) ? source : stage;
}
