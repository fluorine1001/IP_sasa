import { add, sub, scale, length, type Vec } from '../physics/vector.ts';
import type { Body, Stage, WorldObject } from './types.ts';
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
export function gravity(stage: Stage, position: Vec, time: number): Vec {
  return stage.bodies.reduce(
    (sum, body) => {
      const d = sub(bodyPosition(stage, body, time), position),
        r = Math.max(length(d), body.radius * 0.2);
      return add(sum, scale(d, body.mu / r ** 3));
    },
    { x: 0, y: 0 },
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
