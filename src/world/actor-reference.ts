import { bodyPosition, objectPosition } from './celestial';
import type { Stage, Run } from './types';
/** Same scene reference in authoring (initial placement) and actual/replayed flight. */
export function referencePosition(stage: Stage, id: string, time = 0, run?: Run) {
  const body = stage.bodies.find((b) => b.id === id);
  if (body) return bodyPosition(stage, body, time);
  const object = stage.objects.find((o) => o.id === id);
  if (object) return objectPosition(stage, object, time);
  if (id === 'craft') return run?.position ?? stage.spawn.position;
  if ([...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].some((p) => p.id === id))
    return run
      ? run.detached.find((a) => a.id === id && a.status !== 'crashed')?.position
      : stage.spawn.position;
  return undefined;
}
