import { bodyPosition } from '../world/celestial';
import { surfaceClearance, syncLaunch } from '../world/launch';
import { add, scale, dot, length, sub, type Vec } from '../physics/vector';
import { craftHull, hullGap, sweepHull } from '../world/hull';
import type { Stage, Body } from '../world/types';

const attachable = (body: Body) => ['planet', 'moon'].includes(body.kind);
const solids = (stage: Stage) => stage.bodies.filter((body) => body.kind !== 'barycenter');
const heading = (stage: Stage) => ({
  x: Math.cos(stage.launchAngle ?? 0),
  y: Math.sin(stage.launchAngle ?? 0),
});
/** Exact-center input retains the last bearing instead of arbitrarily snapping to angle zero. */
function bearing(stage: Stage, body: Body, point: Vec, fallback = stage.spawn.position) {
  const center = bodyPosition(stage, body, 0);
  const radial = sub(point, center);
  if (length(radial) > 1e-9) return Math.atan2(radial.y, radial.x);
  if (stage.launchBodyId === body.id) return stage.launchAngle ?? 0;
  const previous = sub(fallback, center);
  return length(previous) > 1e-9 ? Math.atan2(previous.y, previous.x) : (stage.launchAngle ?? 0);
}
function attach(stage: Stage, body: Body, angle: number) {
  stage.launchAngle = angle;
  if (attachable(body)) {
    stage.launchBodyId = body.id;
    syncLaunch(stage);
  } else {
    // Stars/black holes have exclusion boundaries, not landable launch pads.
    stage.launchBodyId = undefined;
    stage.spawn.position = add(
      bodyPosition(stage, body, 0),
      scale(heading(stage), body.radius + surfaceClearance(stage)),
    );
  }
}
/** Check the shared full hull, not just the launch foot. A finite fallback clears overlapping solids. */
function clearIntersections(stage: Stage) {
  const bodies = solids(stage),
    hull = craftHull(stage),
    clearance = surfaceClearance(stage);
  for (let pass = 0; pass < 12; pass++) {
    let hit = false;
    for (const body of bodies) {
      if (
        hullGap(
          stage.spawn.position,
          heading(stage),
          hull,
          bodyPosition(stage, body, 0),
          body.radius,
        ) >=
        clearance - 1e-9
      )
        continue;
      attach(stage, body, bearing(stage, body, stage.spawn.position));
      hit = true;
    }
    if (!hit) return;
  }
  // Half-plane support bound: the complete forward-facing capsule is beyond every solid.
  const axis = heading(stage),
    origin = stage.spawn.position;
  const distance = bodies.reduce(
    (max, body) =>
      Math.max(max, dot(sub(bodyPosition(stage, body, 0), origin), axis) + body.radius + clearance),
    0,
  );
  stage.launchBodyId = undefined;
  stage.spawn.position = add(origin, scale(axis, distance + 1e-6));
}
/** Pointer inside a body slides the rocket around its surface; outside pulls it free. */
export function placeSpawn(
  stage: Stage,
  point: Vec,
  freeVelocity = stage.spawn.velocity,
  pointer = point,
) {
  const bodies = solids(stage),
    hull = craftHull(stage),
    axis = heading(stage);
  let touching: Body | undefined,
    best = Infinity;
  for (const body of bodies) {
    const center = bodyPosition(stage, body, 0);
    const pointerInside = length(sub(pointer, center)) <= body.radius;
    const footInside = length(sub(point, center)) <= body.radius;
    const gap = hullGap(point, axis, hull, center, body.radius);
    if (!pointerInside && !footInside && gap > surfaceClearance(stage) + 0.005) continue;
    const score = pointerInside ? -2 : footInside ? -1 : Math.abs(gap);
    if (score < best || (score === best && body.id === stage.launchBodyId)) {
      touching = body;
      best = score;
    }
  }
  const previous = { ...stage.spawn.position };
  stage.spawn.placed = true;
  stage.spawn.position = { ...point };
  stage.spawn.velocity = { ...freeVelocity };
  if (touching) {
    const center = bodyPosition(stage, touching, 0);
    const aim = length(sub(pointer, center)) <= touching.radius ? pointer : point;
    attach(stage, touching, bearing(stage, touching, aim, previous));
  } else stage.launchBodyId = undefined;
  clearIntersections(stage);
  return stage.bodies.find((body) => body.id === stage.launchBodyId);
}

export type PlacementSnapshot = {
  position: Vec;
  direction: Vec;
  bodies: Map<string, { position: Vec; radius: number }>;
};
export function placementSnapshot(stage: Stage): PlacementSnapshot {
  return {
    position: { ...stage.spawn.position },
    direction: heading(stage),
    bodies: new Map(
      solids(stage).map((b) => [
        b.id,
        { position: { ...bodyPosition(stage, b, 0) }, radius: b.radius },
      ]),
    ),
  };
}
/** Either side may move: first swept contact binds, then the rocket follows the moved body. */
export function followSpawn(stage: Stage, before: PlacementSnapshot) {
  if (stage.spawn.placed === false) return;
  const originalBinding = stage.launchBodyId;
  syncLaunch(stage);
  const after = stage.spawn.position,
    hull = craftHull(stage);
  let contact: { body: Body; time: number; angle: number } | undefined;
  for (const body of solids(stage)) {
    if (body.id === originalBinding) continue;
    const prior = before.bodies.get(body.id),
      center = bodyPosition(stage, body, 0);
    if (
      !prior ||
      (length(sub(center, prior.position)) < 1e-12 &&
        body.radius === prior.radius &&
        length(sub(after, before.position)) < 1e-12)
    )
      continue;
    // A growing body uses its actual final boundary; translation keeps the exact swept circle.
    const t = sweepHull(
      before.position,
      after,
      before.direction,
      hull,
      prior.position,
      center,
      Math.max(prior.radius, body.radius) + surfaceClearance(stage) + 0.005,
    );
    if (t === undefined || (contact && t >= contact.time)) continue;
    const atCenter = add(prior.position, scale(sub(center, prior.position), t));
    const atFoot = add(before.position, scale(sub(after, before.position), t));
    const normal = sub(atFoot, atCenter);
    contact = {
      body,
      time: t,
      angle: length(normal) > 1e-9 ? Math.atan2(normal.y, normal.x) : (stage.launchAngle ?? 0),
    };
  }
  if (contact) attach(stage, contact.body, contact.angle);
  clearIntersections(stage);
}
