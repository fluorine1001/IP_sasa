import { evaluateCondition } from './conditions.ts';
import { add, dot, length, scale, sub, type Vec } from '../physics/vector.ts';
import type { GoalContext, GoalProgress } from './types.ts';
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
