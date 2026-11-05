import { add, dot, length, scale, sub, type Vec } from '../physics/vector';
import { bodyPosition, bodyVelocity, objectVelocity } from './celestial';
import { dominantBody } from './conic';
import type { Stage } from './types';

/**
 * Directions in the orbit's own frame. Orbital principles are stated this way
 * ("burn prograde at periapsis"), so the plan is written this way too.
 * The frame is the craft's motion relative to the body with the strongest pull.
 */
export type HeadingFrame = 'prograde' | 'retrograde' | 'outward' | 'inward' | 'match';
export type Heading = {
  frame: HeadingFrame;
  /** For 'match': the object or body whose relative motion the burn cancels. */
  targetId?: string;
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
  match: '상대속도 반대',
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
export function orbitFrame(
  stage: Stage,
  position: Vec,
  velocity: Vec,
  time: number,
  senseOverride?: 1 | -1,
) {
  const body = dominantBody(stage, position, time);
  const r = body ? sub(position, bodyPosition(stage, body, time)) : position,
    v = body ? sub(velocity, bodyVelocity(stage, body, time)) : velocity;
  if (!body || length(r) < 1e-9) {
    // Deep space: no horizon, so the motion itself is the reference.
    const prograde = length(v) > 1e-6 ? unit(v) : { x: 1, y: 0 };
    return { body, prograde, outward: rotate(prograde, Math.PI / 2), radialSpeed: 0 };
  }
  const outward = unit(r);
  const sense = senseOverride ?? turningSense(r, v);
  const prograde = rotate(outward, (sense * Math.PI) / 2);
  return { body, prograde, outward, radialSpeed: dot(v, outward) };
}

/**
 * Which way the craft goes round: clockwise only when it clearly does; a straight
 * up-and-down flight counts as counter-clockwise. Shared by every frame so a burn
 * aimed early and re-read at its trigger agree.
 */
function turningSense(r: Vec, v: Vec) {
  const h = r.x * v.y - r.y * v.x;
  return h < -1e-3 * length(r) * length(v) ? -1 : 1;
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
  const sense = turningSense(r, v);
  return { outward, prograde: rotate(outward, (sense * Math.PI) / 2) };
}
/** A heading in a given frame (see resolveHeading). */
export function headingIn(frame: { prograde: Vec; outward: Vec }, heading: Heading): Vec {
  if (heading.frame === 'match') return frame.prograde;
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
  if (heading.frame === 'match') return matchHeading(stage, velocity, time, heading);
  return headingIn(orbitFrame(stage, position, velocity, time), heading);
}
/**
 * The heading of this moment, keeping the turning sense that brings it closest to
 * `near` (where an armed burn already aimed). At the top of a vertical climb the
 * sideways speed is about zero and either sense is the same orbit; this keeps the
 * burn from turning round at the last moment.
 */
export function resolveHeadingNear(
  stage: Stage,
  position: Vec,
  velocity: Vec,
  time: number,
  heading: Heading,
  near: Vec,
): Vec {
  if (heading.frame === 'match') return matchHeading(stage, velocity, time, heading);
  const [a, b] = ([1, -1] as const).map((sense) =>
    headingIn(orbitFrame(stage, position, velocity, time, sense), heading),
  );
  return dot(a, near) >= dot(b, near) ? a : b;
}
/**
 * Against the motion relative to a target: a burn this way cancels relative velocity.
 * Positive tilt turns counter-clockwise on the map. With no relative motion it points
 * nowhere new, so it falls back to the target's own direction of travel reversed.
 */
export function matchHeading(stage: Stage, velocity: Vec, time: number, heading: Heading): Vec {
  const object = stage.objects.find((o) => o.id === heading.targetId),
    body = stage.bodies.find((b) => b.id === heading.targetId);
  const targetV = object
    ? objectVelocity(stage, object, time)
    : body
      ? bodyVelocity(stage, body, time)
      : { x: 0, y: 0 };
  const relative = sub(velocity, targetV);
  const base = length(relative) > 1e-9 ? scale(unit(relative), -1) : { x: 1, y: 0 };
  return rotate(base, (heading.angle * Math.PI) / 180);
}

/** Short Korean label: "진행 방향", "진행 방향 · 바깥 15°", "바깥 · 진행 10°". */
export function headingLabel(h: Heading) {
  if (h.frame === 'match')
    return (
      headingNames.match +
      (h.angle ? ` · ${h.angle > 0 ? '왼쪽' : '오른쪽'} ${Math.abs(h.angle)}°` : '')
    );
  if (!h.angle) return headingNames[h.frame];
  const along = h.frame === 'prograde' || h.frame === 'retrograde';
  const side = along ? (h.angle > 0 ? '바깥' : '안쪽') : h.angle > 0 ? '진행' : '역진행';
  return `${headingNames[h.frame]} · ${side} ${Math.abs(h.angle)}°`;
}
