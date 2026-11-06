/* 변주 (after a clear): the same mission, started a while earlier on the clock. Every
 * body and object on rails is turned back by its own motion over that time, a spinning
 * pad with it, and the clock limits move by the same amount. The original situation
 * therefore still happens, just later: a plan anchored to events (launch window,
 * apsis, angle, chains) finds it again; a plan of remembered clock times does not.
 * Deterministic per variant number. Only for pad launches with nothing free-moving. */
import { surfaceLaunch, syncLaunch } from './launch';
import type { Body, Stage } from './types';

function omega(stage: Stage, m: NonNullable<Body['motion']>) {
  const parent = stage.bodies.find((b) => b.id === m.parentId);
  return m.angularSpeed ?? (parent ? Math.sqrt(parent.mu / m.radius ** 3) : 0);
}

/** Variants exist only where the author tool proved each one solvable. */
export function canVary(stage: Stage) {
  return (
    !!stage.variants?.length &&
    !!surfaceLaunch(stage) &&
    !stage.bodies.some((b) => b.dynamic) &&
    !stage.objects.some((o) => o.dynamic) &&
    [...stage.bodies, ...stage.objects].some((x) => x.motion && omega(stage, x.motion) > 0)
  );
}

/** How much earlier variant `k` starts: a share of the main moving thing's period. */
export function variantShift(stage: Stage, k: number) {
  const moving = [...stage.objects, ...stage.bodies].find(
    (x) => x.motion && omega(stage, x.motion) > 0,
  )!;
  const period = (2 * Math.PI) / omega(stage, moving.motion!);
  // A golden-ratio walk: variants spread over the cycle without repeating.
  const share = 0.15 + 0.6 * ((k * 0.6180339887) % 1);
  return Math.round(period * share * 10) / 10;
}

export function variantStage(base: Stage, k: number): Stage {
  const stage = structuredClone(base);
  const dt = variantShift(base, k);
  for (const x of [...stage.bodies, ...stage.objects])
    if (x.motion) x.motion.phase -= omega(base, x.motion) * dt;
  const launchBody = stage.bodies.find((b) => b.id === stage.launchBodyId);
  if (launchBody?.spin) stage.launchAngle = (stage.launchAngle ?? 0) - launchBody.spin * dt;
  for (const o of stage.objects)
    if (o.surface) {
      const b = stage.bodies.find((x) => x.id === o.surface!.bodyId);
      if (b?.spin) o.surface.angle -= b.spin * dt;
    }
  if (!stage.rules.maxTimeUnlimited) stage.rules.maxTime += dt;
  for (const g of stage.goals) {
    if (g.startTime > 0) g.startTime += dt;
    if (!g.endTimeUnlimited) g.endTime += dt;
  }
  syncLaunch(stage);
  // Its own id: records, saved plans and medals of a variant stay apart from the mission's.
  stage.id = `${base.id}~v${k}`;
  stage.title = `${base.title} · 변주 ${k}`;
  return stage;
}
