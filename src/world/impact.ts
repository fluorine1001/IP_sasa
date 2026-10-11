import { craftHull, settleHull } from './hull';
import { add, scale, sub, length, dot, type Vec } from '../physics/vector';
import { bodyPosition, bodyVelocity } from './celestial';
import { surfaceClearance } from './launch';
import type { Body, Run, Stage } from './types';
export type Impact = {
  bodyId: string;
  age: number;
  duration: number;
  reason: string;
  contactAngle: number;
  poseAngle: number;
  spin: number;
  bounceHeight: number;
  slide: number;
};
export function beginImpact(run: Run, stage: Stage, body: Body, incoming?: Vec): Impact {
  const center = bodyPosition(stage, body, run.time),
    d = sub(run.position, center),
    n = scale(d, 1 / Math.max(length(d), 1e-9)),
    v = sub(run.velocity, bodyVelocity(stage, body, run.time));
  const direction = incoming ?? run.rocket?.direction ?? v;
  if (run.rocket) run.rocket.throttle = 0;
  return {
    bodyId: body.id,
    age: 0,
    duration: 1.3,
    reason: run.reason,
    contactAngle: Math.atan2(n.y, n.x),
    poseAngle: Math.atan2(direction.y, direction.x),
    spin: Math.max(-0.9, Math.min(0.9, n.x * v.y - n.y * v.x)),
    bounceHeight: Math.min(body.radius * 0.08, Math.max(0.012, Math.abs(dot(v, n)) * 0.06)),
    slide: Math.max(-0.18, Math.min(0.18, (n.x * v.y - n.y * v.x) / Math.max(body.radius, 0.01))),
  };
}
export function impactDirection(impact: Impact): Vec {
  const angle = impact.poseAngle + (impact.spin * (1 - Math.exp(-3 * impact.age))) / 3;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
/** A single visual rebound, followed by settling. Never feed contact jitter back into attitude. */
export function advanceImpact(run: Run, stage: Stage, dt: number) {
  const impact = run.impact!,
    body = stage.bodies.find((b) => b.id === impact.bodyId)!;
  impact.age = Math.min(impact.duration, Math.round((impact.age + Math.max(0, dt)) * 1e12) / 1e12);
  run.time += Math.max(0, dt);
  const center = bodyPosition(stage, body, run.time);
  if (body.kind === 'black-hole')
    run.position = add(center, scale(sub(run.position, center), Math.exp(-dt * 2)));
  else {
    const phase = Math.min(1, impact.age / 0.65),
      height = impact.bounceHeight * 4 * phase * (1 - phase),
      angle = impact.contactAngle + (impact.slide * (1 - Math.exp(-3 * impact.age))) / 3;
    run.position = add(center, {
      x: Math.cos(angle) * (body.radius + surfaceClearance(stage) + height),
      y: Math.sin(angle) * (body.radius + surfaceClearance(stage) + height),
    });
    run.position = settleHull(
      run.position,
      impactDirection(impact),
      craftHull(stage, run),
      center,
      body.radius,
      surfaceClearance(stage),
    );
    run.velocity = bodyVelocity(stage, body, run.time);
  }
  if (impact.age >= impact.duration) {
    run.status = 'failed';
    run.reason = impact.reason;
  }
}
