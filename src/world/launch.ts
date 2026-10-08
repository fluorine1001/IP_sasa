import { bodyPosition, bodyVelocity } from './celestial.ts';
import type { Stage } from './types.ts';
export const PAD_CLEARANCE = 0.005;
/** Physical reference point is the rocket's base, never its painted sprite centre. */
export function surfaceLaunch(stage: Stage, time = 0) {
  const body = stage.bodies.find(
    (b) => b.id === stage.launchBodyId && ['planet', 'moon'].includes(b.kind),
  );
  if (!body) return undefined;
  const center = bodyPosition(stage, body, time),
    angle = stage.launchAngle ?? 0,
    normal = { x: Math.cos(angle), y: Math.sin(angle) };
  return {
    body,
    angle,
    normal,
    position: {
      x: center.x + normal.x * (body.radius + PAD_CLEARANCE),
      y: center.y + normal.y * (body.radius + PAD_CLEARANCE),
    },
    velocity: bodyVelocity(stage, body, time),
  };
}
export function syncLaunch(stage: Stage) {
  const pad = surfaceLaunch(stage);
  if (pad) stage.spawn = { position: pad.position, velocity: pad.velocity };
}
