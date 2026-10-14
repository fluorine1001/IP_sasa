import { craftHull, hullSize } from './hull';
import { add, scale } from '../physics/vector';
import type { Run, Stage } from './types';
/** Visual track point. Physics/collision still use the shared hull's base reference. */
export function craftCenter(stage: Stage, run: Run, actorId = 'craft') {
  const actor = run.detached.find((a) => a.id === actorId);
  if (actor) return add(actor.position, scale(actor.direction, hullSize(1, true).length / 2));
  if (!run.rocket) return { ...run.position };
  return add(run.position, scale(run.rocket.direction, craftHull(stage, run).length / 2));
}
