import { add, dot, length, scale, sub, type Vec } from '../physics/vector';
import { bodyPosition, bodyVelocity } from './celestial';
import { dominantBody } from './conic';
import type { Stage } from './types';

/**
 * Directions in the orbit's own frame. Orbital principles are stated this way
 * ("burn prograde at periapsis"), so the plan is written this way too.
 * The frame is the craft's motion relative to the body with the strongest pull.
 */
export type HeadingFrame = 'prograde' | 'retrograde' | 'outward' | 'inward';
export type Heading = {
  frame: HeadingFrame;
  /** Degrees. Along/against motion: + tilts toward outward. Outward/inward: + tilts toward prograde. */
  angle: number;
};
/**
 * Where an armed command waits after its time: the next highest or lowest point of the
 * current orbit, or the moment it comes down to a set height above the surface.
 */
export type Apsis = 'apoapsis' | 'periapsis' | 'altitude';
export const apsisNames: Record<Apsis, string> = {
  apoapsis: '원점',
  periapsis: '근점',
  altitude: '높이',
};
/** Radial speed and height above the reference body's surface at a state. */
export function triggerReading(stage: Stage, position: Vec, velocity: Vec, time: number) {
  const f = orbitFrame(stage, position, velocity, time);
  const height = f.body
    ? length(sub(position, bodyPosition(stage, f.body, time))) - f.body.radius
    : Infinity;
  return { radial: f.radialSpeed, height };
}
/** True when an armed trigger fires between the previous reading and this one. */
export function triggerFired(
  at: Apsis,
  before: { radial: number; height: number } | undefined,
  now: { radial: number; height: number },
  altitude = 0,
) {
  if (at === 'altitude') return now.radial < 0 && now.height <= altitude;
  if (!before) return false;
  return at === 'apoapsis'
    ? before.radial > 0 && now.radial <= 0
    : before.radial < 0 && now.radial >= 0;
}
export const headingNames: Record<HeadingFrame, string> = {
  prograde: '진행 방향',
  retrograde: '진행 반대',
  outward: '바깥',
  inward: '안쪽',
};

const rotate = (v: Vec, radians: number): Vec => ({
  x: v.x * Math.cos(radians) - v.y * Math.sin(radians),
  y: v.x * Math.sin(radians) + v.y * Math.cos(radians),
});
const unit = (v: Vec) => scale(v, 1 / Math.max(length(v), 1e-12));

/**
 * Local horizon frame: "outward" is straight up from the body, "prograde" is horizontal
 * in the direction the craft goes round (counter-clockwise when it has no sideways motion
 * yet). Unlike the velocity direction, this stays steady at the top of a vertical climb,
 * so "at apoapsis, push prograde" always means the sideways push.
 */
export function orbitFrame(stage: Stage, position: Vec, velocity: Vec, time: number) {
  const body = dominantBody(stage, position, time);
  const r = body ? sub(position, bodyPosition(stage, body, time)) : position,
    v = body ? sub(velocity, bodyVelocity(stage, body, time)) : velocity;
  if (!body || length(r) < 1e-9) {
    // Deep space: no horizon, so the motion itself is the reference.
    const prograde = length(v) > 1e-6 ? unit(v) : { x: 1, y: 0 };
    return { body, prograde, outward: rotate(prograde, Math.PI / 2), radialSpeed: 0 };
  }
  const outward = unit(r);
  const turning = r.x * v.y - r.y * v.x;
  const sense = turning < -1e-9 ? -1 : 1;
  const prograde = rotate(outward, (sense * Math.PI) / 2);
  return { body, prograde, outward, radialSpeed: dot(v, outward) };
}

/**
 * The horizon frame at the next apoapsis or periapsis of the two-body orbit (the same
 * Kepler calculation as the orbit calculator), so an armed apsis burn can turn once,
 * early, instead of turning after the apsis has passed. Undefined when the orbit is a
 * circle or there is no body to orbit.
 */
export function apsisFrame(stage: Stage, position: Vec, velocity: Vec, time: number, at: Apsis) {
  const body = dominantBody(stage, position, time);
  if (!body || at === 'altitude' || !(body.mu > 0)) return undefined;
  const r = sub(position, bodyPosition(stage, body, time)),
    v = sub(velocity, bodyVelocity(stage, body, time));
  const rl = length(r);
  const e = scale(sub(scale(r, dot(v, v) - body.mu / rl), scale(v, dot(r, v))), 1 / body.mu);
  if (length(e) < 1e-3) return undefined;
  const outward = at === 'periapsis' ? unit(e) : scale(unit(e), -1);
  const sense = r.x * v.y - r.y * v.x < -1e-12 ? -1 : 1;
  return { outward, prograde: rotate(outward, (sense * Math.PI) / 2) };
}
/** A heading in a given frame (see resolveHeading). */
export function headingIn(frame: { prograde: Vec; outward: Vec }, heading: Heading): Vec {
  const { prograde, outward } = frame;
  const base =
    heading.frame === 'prograde'
      ? prograde
      : heading.frame === 'retrograde'
        ? scale(prograde, -1)
        : heading.frame === 'outward'
          ? outward
          : scale(outward, -1);
  const toward =
    heading.frame === 'prograde' || heading.frame === 'retrograde' ? outward : prograde;
  const a = (heading.angle * Math.PI) / 180;
  return unit(add(scale(base, Math.cos(a)), scale(toward, Math.sin(a))));
}
export function resolveHeading(
  stage: Stage,
  position: Vec,
  velocity: Vec,
  time: number,
  heading: Heading,
): Vec {
  return headingIn(orbitFrame(stage, position, velocity, time), heading);
}

/** Short Korean label: "진행 방향", "진행 방향 · 바깥 15°", "바깥 · 진행 10°". */
export function headingLabel(h: Heading) {
  if (!h.angle) return headingNames[h.frame];
  const along = h.frame === 'prograde' || h.frame === 'retrograde';
  const side = along ? (h.angle > 0 ? '바깥' : '안쪽') : h.angle > 0 ? '진행' : '역진행';
  return `${headingNames[h.frame]} · ${side} ${Math.abs(h.angle)}°`;
}
