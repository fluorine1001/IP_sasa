import { execute } from '../../world/engine';
import { bodyPosition } from '../../world/celestial';
import type { Body, Stage, Run, RoutePlan } from '../../world/types';

export type GravityEffect = {
  bodyId: string;
  name: string;
  share: number;
  pathDifference: number;
  withoutGravityWon: boolean;
};
export type GravityAudit = {
  passed: boolean;
  effects: GravityEffect[];
  checked: number;
  combined?: { pathDifference: number; withoutGravityWon: boolean };
};
export function bodyForce(
  stage: Stage,
  body: Body,
  position: { x: number; y: number },
  time: number,
  center = bodyPosition(stage, body, time),
) {
  const dx = center.x - position.x,
    dy = center.y - position.y,
    d = Math.max(1e-8, Math.hypot(dx, dy));
  return { x: (body.mu * dx) / d ** 3, y: (body.mu * dy) / d ** 3 };
}
/** Counterfactual authoring flights change only this body's GM; they never mutate the real mission. */
export function auditGravity(stage: Stage, plan: RoutePlan, record?: Run): GravityAudit {
  const run = record ?? execute(stage, plan, true),
    frames = run.frames ?? [],
    radius = stage.bodies.find((b) => b.id === stage.launchBodyId)?.radius ?? 1;
  const effects: GravityEffect[] = [];
  let checked = record ? 0 : 1;
  if (!frames.length) return { passed: false, effects, checked };
  const sample = frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 80)) === 0);
  for (const body of stage.bodies.filter((b) => b.id !== stage.launchBodyId)) {
    let own = 0,
      total = 0;
    for (const f of sample) {
      for (const b of stage.bodies) {
        const force = bodyForce(
          stage,
          b,
          f.position,
          f.time,
          f.bodies?.[b.id]?.position ?? bodyPosition(stage, b, f.time),
        );
        const strength = Math.hypot(force.x, force.y);
        total += strength;
        if (b.id === body.id) own += strength;
      }
    }
    const alternative = structuredClone(stage),
      changed = alternative.bodies.find((b) => b.id === body.id)!;
    changed.mu = 0;
    changed.estimateMu = 0;
    checked++;
    const removed = execute(alternative, plan, true),
      other = removed.frames ?? [];
    let distance = 0,
      j = 0;
    for (const f of sample) {
      while (j + 1 < other.length && other[j + 1].time <= f.time) j++;
      if (!other[j] || Math.abs(other[j].time - f.time) > 0.2) continue;
      distance = Math.max(
        distance,
        Math.hypot(f.position.x - other[j].position.x, f.position.y - other[j].position.y) / radius,
      );
    }
    effects.push({
      bodyId: body.id,
      name: body.name,
      share: own / Math.max(1e-12, total),
      pathDifference: distance,
      withoutGravityWon: removed.status === 'won',
    });
  }
  let combined: GravityAudit['combined'];
  if (effects.length) {
    const alternative = structuredClone(stage);
    for (const body of alternative.bodies)
      if (body.id !== stage.launchBodyId) {
        body.mu = 0;
        body.estimateMu = 0;
      }
    const removed = execute(alternative, plan, true),
      other = removed.frames ?? [];
    checked++;
    let distance = 0,
      j = 0;
    for (const f of sample) {
      while (j + 1 < other.length && other[j + 1].time <= f.time) j++;
      if (other[j] && Math.abs(other[j].time - f.time) <= 0.2)
        distance = Math.max(
          distance,
          Math.hypot(f.position.x - other[j].position.x, f.position.y - other[j].position.y) /
            radius,
        );
    }
    combined = { pathDifference: distance, withoutGravityWon: removed.status === 'won' };
  }
  return {
    passed:
      effects.every((e) => e.share >= 0.08 && (!e.withoutGravityWon || e.pathDifference >= 0.08)) &&
      (!combined || !combined.withoutGravityWon || combined.pathDifference >= 0.35),
    effects,
    checked,
    combined,
  };
}
