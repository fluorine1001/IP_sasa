import { add, sub, scale, type Vec } from '../physics/vector.ts';
import type { Body, Stage, WorldObject } from './types.ts';
import { nativeGravity } from '../physics/nonlinear-native';
export function bodyPosition(stage: Stage, body: Body, time: number): Vec {
  if (body.dynamic)
    return add(body.position, scale(body.dynamic.velocity, time - (body.dynamic.epoch ?? 0)));
  if (!body.motion) return body.position;
  const parent = stage.bodies.find((b) => b.id === body.motion!.parentId)!;
  const angle =
    body.motion.phase +
    (body.motion.angularSpeed ?? Math.sqrt(parent.mu / body.motion.radius ** 3)) * time;
  return add(bodyPosition(stage, parent, time), {
    x: Math.cos(angle) * body.motion.radius,
    y: Math.sin(angle) * body.motion.radius,
  });
}
export function bodyVelocity(stage: Stage, body: Body, time: number): Vec {
  if (body.dynamic) return body.dynamic.velocity;
  if (!body.motion) return { x: 0, y: 0 };
  const parent = stage.bodies.find((b) => b.id === body.motion!.parentId)!,
    omega = body.motion.angularSpeed ?? Math.sqrt(parent.mu / body.motion.radius ** 3),
    angle = body.motion.phase + omega * time;
  return add(bodyVelocity(stage, parent, time), {
    x: -Math.sin(angle) * omega * body.motion.radius,
    y: Math.cos(angle) * omega * body.motion.radius,
  });
}
/** A body's acceleration along its rails (its parent's, plus turning on its circle). */
export function bodyAcceleration(stage: Stage, body: Body, time: number): Vec {
  if (body.dynamic || !body.motion) return { x: 0, y: 0 };
  const parent = stage.bodies.find((b) => b.id === body.motion!.parentId)!,
    omega = body.motion.angularSpeed ?? Math.sqrt(parent.mu / body.motion.radius ** 3),
    angle = body.motion.phase + omega * time;
  return add(bodyAcceleration(stage, parent, time), {
    x: -Math.cos(angle) * omega * omega * body.motion.radius,
    y: -Math.sin(angle) * omega * omega * body.motion.radius,
  });
}
/**
 * Sphere of influence: inside it, this body alone pulls the craft (the standard
 * a·(μ/μ_parent)^0.4). A body on no rails reaches everywhere.
 */
export function sphereOfInfluence(stage: Stage, body: Body): number {
  if (!body.motion) return Infinity;
  const parent = stage.bodies.find((b) => b.id === body.motion!.parentId);
  if (!parent || !(parent.mu > 0)) return Infinity;
  return body.motion.radius * (body.mu / parent.mu) ** 0.4;
}
const pulls = (b: Body) => b.kind !== 'barycenter' && b.mu > 0;
/**
 * The one body whose gravity acts here: the innermost sphere of influence the point is
 * in (a moon's inside its planet's); among bodies that reach everywhere, the strongest.
 * Every orbit is then one body's exact conic, and the map shows whose.
 */
export function influenceBody(stage: Stage, position: Vec, time: number): Body | undefined {
  let best: Body | undefined,
    bestReach = Infinity,
    bestPull = -1;
  for (const b of stage.bodies) {
    if (!pulls(b)) continue;
    const c = bodyPosition(stage, b, time),
      r2 = (position.x - c.x) ** 2 + (position.y - c.y) ** 2,
      reach = sphereOfInfluence(stage, b);
    if (Number.isFinite(reach)) {
      if (r2 < reach * reach && reach < bestReach) {
        best = b;
        bestReach = reach;
      }
    } else if (!Number.isFinite(bestReach)) {
      const pull = b.mu / Math.max(r2, 1e-12);
      if (pull > bestPull) {
        best = b;
        bestPull = pull;
      }
    }
  }
  return best;
}
export function gravity(stage: Stage, position: Vec, time: number): Vec {
  const body = influenceBody(stage, position, time);
  if (!body) return { x: 0, y: 0 };
  // That body's pull, felt in its own moving frame: a moon's orbit around its planet is
  // shared by everything inside the moon's sphere (as in patched-conic flight planning).
  return add(
    nativeGravity(stage, [body], position, time, bodyPosition),
    bodyAcceleration(stage, body, time),
  );
}
export function previewStage(stage: Stage, estimates: Record<string, number>): Stage {
  return {
    ...stage,
    bodies: stage.bodies.map((body) => ({
      ...body,
      mu: body.hiddenGravity ? (estimates[body.id] ?? body.estimateMu) : body.mu,
    })),
  };
}
export const objectPosition = (stage: Stage, object: WorldObject, time: number): Vec =>
  object.surface
    ? (() => {
        const body = stage.bodies.find((b) => b.id === object.surface!.bodyId)!;
        const angle = object.surface!.angle + (body.spin ?? 0) * time;
        return add(bodyPosition(stage, body, time), {
          x: Math.cos(angle) * body.radius,
          y: Math.sin(angle) * body.radius,
        });
      })()
    : object.dynamic
      ? add(object.position, scale(object.dynamic.velocity, time - (object.dynamic.epoch ?? 0)))
      : object.motion
        ? bodyPosition(
            stage,
            { ...object, kind: 'moon', mu: 0, color: '', hiddenGravity: false, estimateMu: 1 },
            time,
          )
        : object.position;
export const objectVelocity = (stage: Stage, object: WorldObject, time: number): Vec =>
  object.surface
    ? (() => {
        const body = stage.bodies.find((b) => b.id === object.surface!.bodyId)!;
        const d = sub(objectPosition(stage, object, time), bodyPosition(stage, body, time));
        return add(bodyVelocity(stage, body, time), scale({ x: -d.y, y: d.x }, body.spin ?? 0));
      })()
    : object.dynamic
      ? object.dynamic.velocity
      : object.motion
        ? bodyVelocity(
            stage,
            { ...object, kind: 'moon', mu: 0, color: '', hiddenGravity: false, estimateMu: 1 },
            time,
          )
        : { x: 0, y: 0 };
/** Velocity of a rotating physical surface at the contact point. */
export function surfaceVelocity(
  stage: Stage,
  body: import('./types').Body,
  position: Vec,
  time: number,
): Vec {
  const relative = sub(position, bodyPosition(stage, body, time));
  return add(
    bodyVelocity(stage, body, time),
    scale({ x: -relative.y, y: relative.x }, body.spin ?? 0),
  );
}
