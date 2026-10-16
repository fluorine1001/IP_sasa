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
  for (const g of c.stage.goals) {
    const p = c.run.goals[g.id];
    if (p.complete || g.dependsOn.some((id) => !c.run.goals[id]?.complete)) continue;
    if (c.run.time < g.startTime || (!g.endTimeUnlimited && c.run.time > g.endTime)) continue;
    if (evaluateCondition(g.condition, c, p)) {
      p.complete = true;
      p.ratio = 1;
    }
  }
}
