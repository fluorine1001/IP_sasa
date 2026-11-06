/* After a flight: where an unmet goal was missed, measured from the record. The
 * closest moment the judge saw, the craft's offset from the target then in the
 * "outward / ahead" axes players reason in, and the last planned change before it
 * (the one a fix most directly reaches). An observation of a finished flight. */
import { bodyPosition, bodyVelocity, objectPosition } from './celestial';
import { dominantBody } from './conic';
import { dynamicView } from './dynamics';
import { objectiveGoals } from './goals';
import { plannedChanges } from './plan-preview';
import type { FlightFrame } from './replay';
import { dot, length, scale, sub, type Vec } from '../physics/vector';
import type { GoalProgress, Run, RoutePlan, Stage } from './types';

export type Miss = {
  goalId: string;
  goalTitle: string;
  targetName: string;
  targetRadius: number;
  time: number;
  craft: Vec;
  target: Vec;
  /** Gap beyond the target's own size (surface or ring edge). */
  gap: number;
  outward: number;
  ahead: number;
  /** Id of the planned change to revisit ('launch' when none came before). */
  cause: string;
  causeLabel: string;
};

export function flightMisses(
  stage: Stage,
  goals: Record<string, GoalProgress>,
  frames: FlightFrame[],
  plan: RoutePlan,
): Miss[] {
  const out: Miss[] = [];
  for (const goal of objectiveGoals(stage)) {
    const p = goals[goal.id];
    if (!p || p.complete) continue;
    // Targets the goal is about: objects it measures, bodies it must reach.
    const ids = new Set<string>();
    const walk = (x: unknown, ref = new Set<string>()) => {
      if (Array.isArray(x)) return x.forEach((y) => walk(y, ref));
      if (!x || typeof x !== 'object') return;
      const o = x as Record<string, unknown>;
      if (o.kind === 'reference' && typeof o.goalId === 'string' && !ref.has(o.goalId)) {
        const g = stage.goals.find((q) => q.id === o.goalId);
        if (g) walk(g.condition, new Set([...ref, o.goalId]));
      }
      if (typeof o.targetId === 'string' && o.targetId) {
        const isObject = stage.objects.some(
          (b) => b.id === o.targetId && b.kind !== 'path' && b.kind !== 'hazard',
        );
        const reach = o.metric === 'distance' || o.event === 'collision' || o.event === 'gate';
        if (isObject || reach) ids.add(o.targetId);
      }
      Object.values(o).forEach((y) => walk(y, ref));
    };
    walk(goal.condition);
    if (goal.marker?.targetId && stage.objects.some((o) => o.id === goal.marker!.targetId))
      ids.add(goal.marker.targetId);
    let best: Omit<Miss, 'cause' | 'causeLabel'> | undefined;
    for (const id of ids) {
      for (const frame of frames) {
        if (frame.time < goal.startTime - 1e-9) continue;
        if (!goal.endTimeUnlimited && frame.time > goal.endTime + 1e-9) break;
        const view = dynamicView(stage, frame as unknown as Run);
        const body = view.bodies.find((b) => b.id === id);
        const object = view.objects.find((o) => o.id === id);
        if (!body && !object) break;
        const target = body
          ? bodyPosition(view, body, frame.time)
          : objectPosition(view, object!, frame.time);
        const radius = body ? body.radius : ((object as { radius?: number }).radius ?? 0);
        const gap = length(sub(frame.position, target)) - radius;
        if (best && gap >= best.gap) continue;
        const centre = dominantBody(view, target, frame.time);
        const offset = sub(frame.position, target);
        let outward = length(offset) - radius,
          ahead = 0;
        if (centre && centre.id !== body?.id) {
          const c = bodyPosition(view, centre, frame.time);
          const r = sub(target, c);
          const v = sub(frame.velocity, bodyVelocity(view, centre, frame.time));
          outward = dot(offset, scale(r, 1 / Math.max(length(r), 1e-12)));
          ahead = dot(offset, scale(v, 1 / Math.max(length(v), 1e-12)));
        }
        best = {
          goalId: goal.id,
          goalTitle: goal.title,
          targetName: body?.name ?? object?.name ?? '목표',
          targetRadius: radius,
          time: frame.time,
          craft: frame.position,
          target,
          gap,
          outward,
          ahead,
        };
      }
    }
    if (!best || best.gap <= 0) continue;
    const last = plannedChanges(plan)
      .filter((c) => c.time <= best!.time + 1e-9)
      .at(-1);
    out.push({ ...best, cause: last?.id ?? 'launch', causeLabel: last?.label ?? '발사' });
  }
  return out.sort((a, b) => a.gap - b.gap);
}

/** "안쪽으로 0.21 u" — the larger of the two axes. */
export function missSide(m: Miss) {
  if (Math.abs(m.outward) >= Math.abs(m.ahead)) return m.outward > 0 ? '바깥쪽으로' : '안쪽으로';
  return m.ahead > 0 ? '앞쪽으로' : '뒤쪽으로';
}
