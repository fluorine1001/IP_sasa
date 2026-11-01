import { evaluateCondition } from './conditions.ts';
import { add, dot, length, scale, sub, type Vec } from '../physics/vector.ts';
import type { GoalContext, GoalProgress } from './types.ts';
import type { Stage, Goal } from './types';
import type { Condition } from './conditions';
export function goalReferences(condition: Condition): string[] {
  if (condition.kind === 'reference') return [condition.goalId];
  if ('children' in condition) return condition.children.flatMap(goalReferences);
  if ('child' in condition) return goalReferences(condition.child);
  if (condition.kind === 'capture') return goalReferences(condition.when);
  return [];
}
/** Referenced annotations remain editable components; only graph roots complete the mission. */
export function objectiveGoals(stage: Stage): Goal[] {
  const children = new Set(stage.goals.flatMap((goal) => goalReferences(goal.condition)));
  return stage.goals.filter((goal) => !children.has(goal.id));
}
export function freshProgress(): GoalProgress {
  return { complete: false, ratio: 0 };
}
export function crossGate(
  before: Vec,
  after: Vec,
  center: Vec,
  angle: number,
  radius: number,
): boolean {
  const normal = { x: Math.cos(angle), y: Math.sin(angle) },
    a = dot(sub(before, center), normal),
    b = dot(sub(after, center), normal);
  if (a * b > 0 || Math.abs(a - b) < 1e-10) return false;
  return length(sub(add(before, scale(sub(after, before), a / (a - b))), center)) <= radius;
}
export function updateGoals(c: GoalContext): void {
  // Dependencies are semantic, never array/layer order. Visit each goal at most once.
  const visited = new Set<string>();
  const byId = new Map(c.stage.goals.map((g) => [g.id, g]));
  const visit = (g: Goal) => {
    if (visited.has(g.id)) return;
    visited.add(g.id);
    for (const id of g.dependsOn) {
      const prerequisite = byId.get(id);
      if (prerequisite) visit(prerequisite);
    }
    const p = c.run.goals[g.id];
    if (p.complete || g.dependsOn.some((id) => !c.run.goals[id]?.complete)) return;
    if (c.run.time < g.startTime - 1e-9 || (!g.endTimeUnlimited && c.run.time > g.endTime + 1e-9))
      return;
    const previousTime = Math.max(
      c.previousTime,
      g.startTime,
      ...g.dependsOn.map((id) => c.run.goals[id]?.completedAt ?? c.previousTime),
    );
    const active = { ...c, previousTime, dt: Math.max(0, c.run.time - previousTime) };
    if (evaluateCondition(g.condition, active, p)) {
      p.complete = true;
      p.ratio = 1;
      p.completedAt = c.run.time;
    }
  };
  c.stage.goals.forEach(visit);
}
