import { compileOutcome, type Outcome } from '../stages/outcomes';
import type { Condition, Expression } from '../world/conditions';
import type { Stage, Goal } from '../world/types';
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, node) =>
    node && typeof node === 'object' && !Array.isArray(node)
      ? Object.fromEntries(
          Object.keys(node)
            .sort()
            .map((key) => [key, node[key]]),
        )
      : node,
  );
/** Inverse only for an exact compiler shape. Never discard a user's extra clauses. */
export function readOutcome(stage: Stage, goal: Goal): Outcome | undefined {
  const nodes: (Condition | Expression)[] = [];
  function visit(node: Condition | Expression) {
    nodes.push(node);
    if ('children' in node) node.children.forEach(visit);
    if ('child' in node) visit(node.child);
    if ('left' in node) {
      visit(node.left);
      visit(node.right);
    }
    if ('args' in node) node.args.forEach(visit);
    if ('value' in node && typeof node.value === 'object') visit(node.value);
    if ('when' in node) visit(node.when);
    if ('domain' in node) {
      visit(node.domain);
      visit(node.width);
    }
  }
  visit(goal.condition);
  const comparisons = nodes.filter(
    (n): n is Extract<Condition, { kind: 'compare' }> => n.kind === 'compare',
  );
  const value = (name: string, operator: string) => {
    const node = comparisons.find(
      (n) =>
        n.left.kind === 'metric' &&
        n.left.metric === name &&
        n.operator === operator &&
        n.right.kind === 'constant',
    );
    return node?.right.kind === 'constant' ? node.right.value : undefined;
  };
  const first = nodes.find(
    (n): n is Extract<Expression, { kind: 'metric' }> => n.kind === 'metric' && !!n.targetId,
  );
  const targetId = first?.targetId ?? goal.display?.targetId ?? stage.bodies[0]?.id;
  const actorId = first?.actorId ?? 'craft';
  if (!targetId) return;
  const duration = nodes.find(
    (n): n is Extract<Condition, { kind: 'hold' }> => n.kind === 'hold',
  )?.duration;
  const fraction = comparisons.find(
    (n) =>
      n.left.kind === 'window' &&
      n.left.operation === 'fractionPositive' &&
      n.right.kind === 'constant',
  );
  const insideFraction = fraction?.right.kind === 'constant' ? fraction.right.value : 1;
  const timeWindow = nodes.find(
    (n): n is Extract<Expression, { kind: 'window' }> =>
      n.kind === 'window' &&
      n.domain.kind === 'metric' &&
      n.domain.metric === 'time' &&
      n.width.kind === 'constant',
  );
  const candidates: Outcome[] = [];
  const min = value('distance', 'gte'),
    max = value('distance', 'lte'),
    eccentricity = value('eccentricity', 'lte'),
    speed = value('speed', 'lte');
  if (min !== undefined && max !== undefined) {
    if (duration !== undefined && eccentricity !== undefined)
      candidates.push({ kind: 'circular', targetId, actorId, min, max, eccentricity, duration });
    candidates.push({ kind: 'orbit', targetId, actorId, min, max, insideFraction });
  }
  if (max !== undefined && speed !== undefined && duration !== undefined)
    candidates.push({ kind: 'rendezvous', targetId, actorId, max, speed, duration });
  const touchdown = value('touchdownSpeed', 'lte');
  if (touchdown !== undefined && duration !== undefined)
    candidates.push({ kind: 'recovery', targetId, actorId, speed: touchdown, duration });
  if (min !== undefined && duration !== undefined)
    candidates.push({ kind: 'escape', targetId, actorId, min, duration });
  const low = value('altitude', 'gte'),
    high = value('altitude', 'lte');
  if (low !== undefined && high !== undefined && duration !== undefined)
    candidates.push({
      kind: 'region',
      targetId,
      actorId,
      min: low,
      max: high,
      duration,
      coast: value('throttle', 'eq') === 0,
    });
  for (const metric of nodes.filter(
    (n): n is Extract<Expression, { kind: 'metric' }> => n.kind === 'metric',
  )) {
    const lower = value(metric.metric, 'gte'),
      upper = value(metric.metric, 'lte'),
      seconds =
        duration ?? (timeWindow?.width.kind === 'constant' ? timeWindow.width.value : undefined);
    if (lower !== undefined && upper !== undefined && seconds !== undefined)
      candidates.push({
        kind: 'environment',
        targetId,
        actorId,
        metric: metric.metric,
        min: lower,
        max: upper,
        duration: seconds,
        insideFraction,
      });
  }
  for (const outcome of candidates) {
    try {
      const generated = compileOutcome(stage, outcome);
      if (canonical(generated.condition) === canonical(goal.condition)) return outcome;
    } catch {
      /* Not a recognised compiler result. */
    }
  }
}
