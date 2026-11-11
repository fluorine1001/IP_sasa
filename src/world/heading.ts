import { add, dot, length, scale, sub, type Vec } from '../physics/vector';
import { bodyPosition, bodyVelocity, objectVelocity, objectPosition } from './celestial';
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
  /**
   * The body whose horizon the frame is read from. Unset: the body pulling hardest when
   * the turn begins, then kept for as long as the turn holds (it never switches silently).
   */
  body?: string;
};
/**
 * Where an armed command waits after its time: the next highest or lowest point of the
 * current orbit, or the moment it comes down to a set height above the surface.
 */
/**
 * When an armed reservation fires. Event triggers keep a reservation tied to a place
 * on the orbit (or to the reservation before it) rather than to a clock time, so
 * changing an earlier reservation does not move where a later one acts.
 */
export type Apsis = 'apoapsis' | 'periapsis' | 'altitude' | 'after' | 'angle' | 'phase' | 'near';
export const apsisNames: Record<Apsis, string> = {
  apoapsis: '원점',
  periapsis: '근점',
  altitude: '높이',
  after: '앞 예약 뒤',
  angle: '위치각',
  phase: '목표 각도',
  near: '목표 접근',
};
/** Everything a trigger needs; stored on the reservation. */
export type TriggerSpec = {
  at: Apsis;
  altitude?: number;
  /** after: seconds after `ref` finished. */
  delay?: number;
  ref?: string;
  /** angle: craft's angle around the body; phase: target's angle minus the craft's (degrees). */
  atAngle?: number;
  phaseTarget?: string;
  /**
   * The body the height, apsis and angle are measured around. Unset: the body pulling
   * hardest when the reservation is armed, then kept until it fires.
   */
  body?: string;
};
export type TriggerReading = {
  radial: number;
  height: number;
  time: number;
  /** Degrees, counter-clockwise from the map's +x, around the body pulling hardest. */
  angle: number;
  phase?: number;
  /** Distance to the phase/near target. */
  gap?: number;
};
function objectPositionOf(stage: Stage, o: Stage['objects'][number], time: number) {
  return objectPosition(stage, o, time);
}
/** A named reference body, or (unset or unknown) the body pulling hardest here and now. */
export function referenceBody(stage: Stage, position: Vec, time: number, bodyId?: string) {
  const named = bodyId ? stage.bodies.find((b) => b.id === bodyId && b.mu > 0) : undefined;
  return named ?? dominantBody(stage, position, time);
}
/** Fix an unnamed reference body to the one pulling hardest now (it then never switches). */
export function settleBody<T extends { body?: string }>(
  stage: Stage,
  x: T,
  position: Vec,
  time: number,
): T {
  if (x.body) return x;
  const body = dominantBody(stage, position, time);
  return body ? { ...x, body: body.id } : x;
}
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
/** Radial speed and height above the reference body's surface at a state. */
export function triggerReading(
  stage: Stage,
  position: Vec,
  velocity: Vec,
  time: number,
  phaseTarget?: string,
  bodyId?: string,
): TriggerReading {
  const f = orbitFrame(stage, position, velocity, time, undefined, bodyId);
  const centre = f.body ? bodyPosition(stage, f.body, time) : { x: 0, y: 0 };
  const r = sub(position, centre);
  const height = f.body ? length(r) - f.body.radius : Infinity;
  const angle = (Math.atan2(r.y, r.x) * 180) / Math.PI;
  let phase: number | undefined, gap: number | undefined;
  if (phaseTarget) {
    const b = stage.bodies.find((x) => x.id === phaseTarget);
    const o = stage.objects.find((x) => x.id === phaseTarget);
    const p = b ? bodyPosition(stage, b, time) : o ? objectPositionOf(stage, o, time) : undefined;
    if (p) {
      const q = sub(p, centre);
      phase = wrap180((Math.atan2(q.y, q.x) * 180) / Math.PI - angle);
      gap = length(sub(position, p));
    }
  }
  return { radial: f.radialSpeed, height, time, angle, phase, gap };
}
/** True when an armed trigger fires between the previous reading and this one. */
export function triggerFired(
  t: TriggerSpec,
  before: TriggerReading | undefined,
  now: TriggerReading,
  firedAt?: Record<string, number>,
) {
  if (t.at === 'altitude') return now.radial < 0 && now.height <= (t.altitude ?? 0);
  // Coming within a set distance of the target (centre to centre).
  if (t.at === 'near') return now.gap !== undefined && now.gap <= (t.altitude ?? 0);
  if (t.at === 'after') {
    const done = t.ref ? firedAt?.[t.ref] : undefined;
    return done !== undefined && now.time >= done + (t.delay ?? 0) - 1e-9;
  }
  if (!before) return false;
  if (t.at === 'angle' || t.at === 'phase') {
    const a = t.at === 'angle' ? before.angle : before.phase,
      b = t.at === 'angle' ? now.angle : now.phase;
    if (a === undefined || b === undefined) return false;
    const da = wrap180(a - (t.atAngle ?? 0)),
      db = wrap180(b - (t.atAngle ?? 0));
    // A crossing of the set angle (in either direction of travel), not the wrap-around.
    return Math.abs(da) < 90 && Math.abs(db) < 90 && (da === 0 || Math.sign(da) !== Math.sign(db));
  }
  return t.at === 'apoapsis'
    ? before.radial > 0 && now.radial <= 0
    : before.radial < 0 && now.radial >= 0;
}
/** The trigger fields of a reservation (burn or push). */
export function triggerOf(x: {
  at?: Apsis;
  altitude?: number;
  delay?: number;
  ref?: string;
  atAngle?: number;
  phaseTarget?: string;
  body?: string;
}): TriggerSpec | undefined {
  return x.at
    ? {
        at: x.at,
        altitude: x.altitude,
        delay: x.delay,
        ref: x.ref,
        atAngle: x.atAngle,
        phaseTarget: x.phaseTarget,
        ...(x.body ? { body: x.body } : {}),
      }
    : undefined;
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
  bodyId?: string,
) {
  const body = referenceBody(stage, position, time, bodyId);
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
export function apsisFrame(
  stage: Stage,
  position: Vec,
  velocity: Vec,
  time: number,
  at: Apsis,
  bodyId?: string,
) {
  const body = referenceBody(stage, position, time, bodyId);
  if (!body || (at !== 'apoapsis' && at !== 'periapsis') || !(body.mu > 0)) return undefined;
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
  return headingIn(orbitFrame(stage, position, velocity, time, undefined, heading.body), heading);
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
    headingIn(orbitFrame(stage, position, velocity, time, sense, heading.body), heading),
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

/** Velocity relative to a match target (for "stop when matched"). */
export function relativeTo(stage: Stage, velocity: Vec, time: number, targetId?: string): Vec {
  const object = stage.objects.find((o) => o.id === targetId),
    body = stage.bodies.find((b) => b.id === targetId);
  const targetV = object
    ? objectVelocity(stage, object, time)
    : body
      ? bodyVelocity(stage, body, time)
      : { x: 0, y: 0 };
  return sub(velocity, targetV);
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
