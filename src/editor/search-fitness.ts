import { expressionValue, type Condition, type Expression } from '../world/conditions';
import { dynamicView } from '../world/dynamics';
import { objectiveGoals } from '../world/goals';
import { metrics } from '../world/metrics';
import type { Stage, Run, GoalContext, GoalProgress } from '../world/types';
const stateful = new WeakMap<Expression, boolean>();
function hasWindow(e: Expression): boolean {
  const old = stateful.get(e);
  if (old !== undefined) return old;
  const value = e.kind === 'window' || (e.kind === 'calculate' && e.args.some(hasWindow));
  stateful.set(e, value);
  return value;
}

/** Search-only continuous residuals. Never changes or substitutes a runtime predicate. */
export function searchFitness(stage: Stage, run: Run) {
  const view = dynamicView(stage, run);
  const context: GoalContext = {
    stage: view,
    run,
    before: run.position,
    dt: 0,
    previousTime: run.time,
  };
  const scalar = (
    node: Condition,
    c: GoalContext,
    p: GoalProgress,
    path = 'root',
    depth = 0,
  ): number => {
    if (depth > 24) return 0;
    const next = (child: Condition, at: string, ctx = c) => scalar(child, ctx, p, at, depth + 1);
    if (node.kind === 'reference') {
      const g = stage.goals.find((g) => g.id === node.goalId);
      return g ? next(g.condition, `${path}.ref:${g.id}`) : 0;
    }
    if (node.kind === 'quantify') {
      const values = node.actorIds.flatMap((actorId) =>
        (node.targetIds ?? [''])
          .filter((targetId) => !node.excludeSelf || actorId !== targetId)
          .map((targetId) =>
            next(node.child, `${path}.${actorId}.${targetId}`, {
              ...c,
              bindings: { actorId, targetId, scope: `${path}.${actorId}.${targetId}` },
            }),
          ),
      );
      values.sort((a, b) => b - a);
      return node.mode === 'any'
        ? (values[0] ?? 0)
        : node.mode === 'atLeast'
          ? (values[(node.count ?? 1) - 1] ?? 0)
          : aggregate(values);
    }
    if (node.kind === 'compare') {
      // Stateful window expressions are owned by the real evaluator; this observer must not advance them.
      const read = (e: typeof node.left): number =>
        hasWindow(e)
          ? NaN
          : expressionValue(e, c, p, `${path}.${e === node.left ? 'left' : 'right'}`);
      const a = read(node.left),
        b = read(node.right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return p.ratio * 0.8;
      if (node.left.kind === 'metric' && node.left.metric === 'landed' && a < 0.5 && b >= 0.5) {
        const targetId =
          node.left.targetId === '$target' ? (c.bindings?.targetId ?? '') : node.left.targetId;
        const actorId = node.left.actorId === '$actor' ? c.bindings?.actorId : node.left.actorId;
        const query = (metric: string) =>
          expressionValue({ kind: 'metric', metric, targetId, actorId }, c, p);
        const body = view.bodies.find((v) => v.id === targetId);
        if (body)
          return (
            0.75 / (1 + Math.max(0, query('distance') - body.radius) / Math.max(body.radius, 0.1)) +
            0.2 / (1 + Math.abs(query('speed')) / 0.25)
          );
      }
      const violation =
        node.operator === 'eq'
          ? Math.abs(a - b)
          : ['gte', 'gt'].includes(node.operator)
            ? Math.max(0, b - a)
            : Math.max(0, a - b);
      const unit = node.left.kind === 'metric' ? metrics[node.left.metric]?.unit : '';
      const scale = Math.max(Math.abs(b), unit === 'u' ? 0.3 : unit === 'u/t' ? 0.2 : 0.1);
      return 1 / (1 + violation / scale);
    }
    if (node.kind === 'event') {
      const target = view.bodies.find((b) => b.id === node.targetId);
      if (node.event === 'collision' && target) {
        const d =
          Math.hypot(run.position.x - target.position.x, run.position.y - target.position.y) -
          target.radius;
        return 1 / (1 + Math.max(0, d) / Math.max(target.radius, 0.1));
      }
      return p.conditionMemory?.[path]?.latched ? 1 : 0;
    }
    if (node.kind === 'hold')
      return (
        next(node.child, path + '.child') * 0.85 +
        Math.min(1, (p.conditionMemory?.[path]?.hold ?? 0) / node.duration) * 0.15
      );
    if (node.kind === 'capture')
      return p.checkpoints?.[node.key] ? 1 : next(node.when, path + '.when');
    if (node.kind === 'once')
      return p.conditionMemory?.[path]?.latched ? 1 : next(node.child, path + '.child');
    if (node.kind === 'not') return 1 - next(node.child, path + '.child');
    if (node.kind === 'sequence') {
      const index = p.conditionMemory?.[path]?.index ?? 0;
      return Math.min(
        1,
        (index + (node.children[index] ? next(node.children[index], `${path}.${index}`) : 0)) /
          Math.max(1, node.children.length),
      );
    }
    if (!('children' in node)) return 0;
    const values = node.children.map((n, i) => next(n, `${path}.${i}`));
    return node.kind === 'any' ? Math.max(0, ...values) : aggregate(values);
  };
  const scores = objectiveGoals(stage).map((g) => {
    const p = run.goals[g.id];
    return p.complete
      ? 1
      : scalar(g.condition, context, {
          ...p,
          conditionMemory: structuredClone(p.conditionMemory),
          windows: undefined,
        });
  });
  return stage.goalMode === 'any' ? Math.max(0, ...scores) : aggregate(scores);
}
function aggregate(values: number[]) {
  return values.length
    ? Math.min(...values) * 0.65 + (values.reduce((a, b) => a + b, 0) / values.length) * 0.35
    : 0;
}
