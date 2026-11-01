import { bodyPosition, objectPosition } from './celestial';
import { sweepHull, type Hull } from './hull';
import type { Vec } from '../physics/vector';
import type { Body, Stage, WorldObject } from './types';

export function physicalRadius(object: WorldObject) {
  return object.kind === 'station'
    ? (object.physicalRadius ?? 0)
    : ['debris', 'satellite'].includes(object.kind)
      ? object.radius
      : 0;
}
export type Contact = { fraction: number; body?: Body; object?: WorldObject };
/** One chronology for all physical obstacles. Sensor/goal regions never collide. */
export function firstContact(
  start: Stage,
  end: Stage,
  before: Vec,
  after: Vec,
  previousHeading: Vec,
  heading: Vec,
  hull: Hull,
  startTime: number,
  endTime: number,
  attachedBody?: string,
): Contact | undefined {
  let first: Contact | undefined;
  for (const body of end.bodies) {
    if (body.kind === 'barycenter' || body.id === attachedBody) continue;
    const previous = start.bodies.find((b) => b.id === body.id) ?? body;
    const fraction = sweepHull(
      before,
      after,
      heading,
      hull,
      bodyPosition(start, previous, startTime),
      bodyPosition(end, body, endTime),
      body.radius,
      previousHeading,
    );
    if (fraction !== undefined && (!first || fraction < first.fraction)) first = { fraction, body };
  }
  for (const object of end.objects) {
    const radius = physicalRadius(object);
    if (radius <= 0) continue;
    const previous = start.objects.find((o) => o.id === object.id) ?? object;
    const fraction = sweepHull(
      before,
      after,
      heading,
      hull,
      objectPosition(start, previous, startTime),
      objectPosition(end, object, endTime),
      radius,
      previousHeading,
    );
    if (fraction !== undefined && (!first || fraction <= first.fraction))
      first = { fraction, object };
  }
  return first;
}
