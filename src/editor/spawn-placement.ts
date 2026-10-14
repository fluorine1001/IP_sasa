import { bodyPosition } from '../world/celestial';
import { surfaceClearance, syncLaunch } from '../world/launch';
import { length, sub, type Vec } from '../physics/vector';
import type { Stage } from '../world/types';
/** Only the rocket's launch foot touching a real surface binds it. No screen-sized magnet. */
export function placeSpawn(stage: Stage, point: Vec, freeVelocity = stage.spawn.velocity) {
  const touching = stage.bodies
    .filter((body) => ['planet', 'moon'].includes(body.kind))
    .map((body) => {
      const center = bodyPosition(stage, body, 0);
      const radial = sub(point, center);
      return { body, radial, gap: length(radial) - body.radius };
    })
    .filter(({ gap }) => gap >= -0.005 && gap <= surfaceClearance(stage) + 0.005)
    .sort(
      (a, b) =>
        Math.abs(a.gap - surfaceClearance(stage)) - Math.abs(b.gap - surfaceClearance(stage)),
    )[0];
  stage.spawn.placed = true;
  if (touching) {
    stage.launchBodyId = touching.body.id;
    stage.launchAngle = Math.atan2(touching.radial.y, touching.radial.x);
    syncLaunch(stage);
  } else {
    stage.launchBodyId = undefined;
    stage.spawn.position = { ...point };
    stage.spawn.velocity = { ...freeVelocity };
  }
  return touching?.body;
}
