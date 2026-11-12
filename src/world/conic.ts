import { influenceBody } from './celestial';
/* Two-body orbit calculator (the player's "궤도 계산기").
 * Given one state, the conic it would follow around the single body pulling hardest on it,
 * ignoring every other body, atmosphere and engine. This is a calculation tool the
 * player reads, never the game's prediction of the real flight: multi-body gravity,
 * drag, burns and contact are only known by flying. */
import type { Vec } from '../physics/vector';
import type { Body, Stage } from './types';
import { bodyPosition, bodyVelocity } from './celestial';

export type Conic = {
  body: Body;
  /** Body centre (the focus) and its velocity at the sampled time. */
  focus: Vec;
  /** Craft position/velocity relative to the body. */
  r: Vec;
  v: Vec;
  mu: number;
  /** Specific orbital energy; < 0 means bound. */
  energy: number;
  /** Signed specific angular momentum (counter-clockwise > 0). */
  h: number;
  e: number;
  /** Angle of the periapsis direction (radians, world frame). */
  periapsisAngle: number;
  /** Semi-latus rectum. */
  p: number;
  /** Semi-major axis (negative for hyperbolas, Infinity for parabolas). */
  a: number;
  periapsis: number;
  /** Infinity when the craft escapes. */
  apoapsis: number;
  /** Seconds; undefined when unbound. */
  period?: number;
  bound: boolean;
  /** Open path already moving away from its periapsis (it never comes back). */
  periapsisPassed: boolean;
  /** Current true anomaly. */
  nu: number;
  /** True anomaly where the path next meets the surface, if it does. */
  impactNu?: number;
  altitude: number;
  speed: number;
  circularSpeed: number;
  escapeSpeed: number;
};

/** The body with the strongest pull (mu / r²) at a point. */
/** The body whose orbit the craft is on: the sphere of influence it is in. */
export function dominantBody(stage: Stage, position: Vec, time: number): Body | undefined {
  return influenceBody(stage, position, time);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function conicAround(
  body: Body,
  focus: Vec,
  bodyV: Vec,
  position: Vec,
  velocity: Vec,
): Conic {
  const mu = body.mu;
  const r = { x: position.x - focus.x, y: position.y - focus.y };
  const v = { x: velocity.x - bodyV.x, y: velocity.y - bodyV.y };
  const rn = Math.hypot(r.x, r.y);
  const speed = Math.hypot(v.x, v.y);
  const h = r.x * v.y - r.y * v.x;
  const energy = (speed * speed) / 2 - mu / rn;
  // Eccentricity vector: ((v² − μ/r) r − (r·v) v) / μ
  const rv = r.x * v.x + r.y * v.y;
  const k = speed * speed - mu / rn;
  const ev = { x: (k * r.x - rv * v.x) / mu, y: (k * r.y - rv * v.y) / mu };
  const e = Math.hypot(ev.x, ev.y);
  const p = (h * h) / mu;
  const periapsisAngle = e > 1e-9 ? Math.atan2(ev.y, ev.x) : Math.atan2(r.y, r.x);
  const sense = h >= 0 ? 1 : -1;
  const nu = wrap(sense * (Math.atan2(r.y, r.x) - periapsisAngle));
  const bound = energy < 0;
  const a = Math.abs(energy) < 1e-12 ? Infinity : -mu / (2 * energy);
  // a(1 ∓ e) stays exact for a straight up-and-down path (h → 0, e → 1) where p/(1 − e) fails.
  const periapsis = bound ? a * (1 - e) : p / (1 + e);
  const apoapsis = bound ? a * (1 + e) : Infinity;
  const period = bound ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : undefined;
  let impactNu: number | undefined;
  if (periapsis < body.radius && Math.abs(h) > 1e-9) {
    // r(ν) = p / (1 + e cos ν) = R  →  cos ν = (p/R − 1)/e; the craft moves towards +ν.
    const c = e > 1e-12 ? (p / body.radius - 1) / e : 2;
    // The craft moves towards +ν; the inbound crossing (dr/dν ∝ sin ν < 0) is at −acos(c).
    if (Math.abs(c) <= 1) {
      const n0 = -Math.acos(c);
      // An open path only meets the surface if it has not yet passed that crossing.
      if (bound || nu < n0) impactNu = n0;
    }
  } else if (Math.abs(h) <= 1e-9 && (rv < 0 || bound)) impactNu = nu; // straight fall
  const periapsisPassed = !bound && nu > 0;
  return {
    body,
    focus,
    r,
    v,
    mu,
    energy,
    h,
    e,
    periapsisAngle,
    p,
    a,
    periapsis,
    apoapsis,
    period,
    bound,
    periapsisPassed,
    nu,
    impactNu,
    altitude: rn - body.radius,
    speed,
    circularSpeed: Math.sqrt(mu / rn),
    escapeSpeed: Math.sqrt((2 * mu) / rn),
  };
}

export function conicOf(
  stage: Stage,
  position: Vec,
  velocity: Vec,
  time: number,
): Conic | undefined {
  const body = dominantBody(stage, position, time);
  if (!body) return undefined;
  return conicAround(
    body,
    bodyPosition(stage, body, time),
    bodyVelocity(stage, body, time),
    position,
    velocity,
  );
}

/** World point at true anomaly ν. */
export function conicPoint(c: Conic, nu: number): Vec {
  const sense = c.h >= 0 ? 1 : -1;
  const radius = c.p / (1 + c.e * Math.cos(nu));
  const ang = c.periapsisAngle + sense * nu;
  return { x: c.focus.x + radius * Math.cos(ang), y: c.focus.y + radius * Math.sin(ang) };
}

/** Points along the conic from the craft forward, stopping at the surface or `maxRadius`. */
export function conicPath(c: Conic, maxRadius: number, steps = 240): Vec[] {
  if (Math.abs(c.h) < 1e-12) return [];
  let end: number;
  if (c.impactNu !== undefined) {
    end = c.impactNu - c.nu;
    if (end <= 0) end += 2 * Math.PI;
  } else if (c.bound) end = 2 * Math.PI;
  else {
    // Asymptote at cos ν = −1/e; stop where r reaches maxRadius.
    const limit = c.e > 1 ? Math.acos(-1 / c.e) - 1e-3 : Math.PI - 1e-3;
    const cosMax = (c.p / maxRadius - 1) / Math.max(c.e, 1e-9);
    const stop = Math.abs(cosMax) <= 1 ? Math.min(limit, Math.acos(cosMax)) : limit;
    end = Math.max(0, stop - c.nu);
  }
  const out: Vec[] = [];
  for (let i = 0; i <= steps; i++) out.push(conicPoint(c, c.nu + (end * i) / steps));
  return out;
}

/** Figures a player reads to judge a body: everything derives from mu and radius. */
export function bodyFacts(body: Body) {
  const R = body.radius;
  return {
    surfaceGravity: body.mu / (R * R),
    surfaceOrbitSpeed: Math.sqrt(body.mu / R),
    escapeSpeed: Math.sqrt((2 * body.mu) / R),
    orbitSpeedAt: (altitude: number) => Math.sqrt(body.mu / (R + altitude)),
    periodAt: (altitude: number) => 2 * Math.PI * Math.sqrt((R + altitude) ** 3 / body.mu),
  };
}
