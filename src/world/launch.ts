import { bodyPosition, bodyVelocity } from './celestial.ts';
import type { Stage } from './types.ts';
export const PAD_CLEARANCE = 0.005;
export function syncLaunch(stage: Stage) {
  const body = stage.bodies.find((b) => b.id === stage.launchBodyId);
  if (!body) return;
  const center = bodyPosition(stage, body, 0),
    angle = stage.launchAngle ?? 0;
  stage.spawn = {
    position: {
      x: center.x + Math.cos(angle) * (body.radius + PAD_CLEARANCE),
      y: center.y + Math.sin(angle) * (body.radius + PAD_CLEARANCE),
    },
    velocity: bodyVelocity(stage, body, 0),
  };
}
