/* Aiming calculator (the orbit calculator's time axis; AGENTS.md exception).
 * From one state, the two-body path around the body pulling hardest at that moment,
 * propagated in time analytically, and how close it comes to a mission target whose
 * motion is scripted. Only that one body's gravity: no target gravity, other bodies,
 * atmosphere, burn duration or contact. A calculation the player aims with, never a
 * forecast of the real flight; the real flight is only known by flying. */
import { add, dot, length, scale, sub, type Vec } from '../physics/vector';
import { bodyPosition, bodyVelocity, objectPosition } from './celestial';
import { dominantBody } from './conic';
import type { Body, Stage, WorldObject } from './types';

export type AimState = { position: Vec; velocity: Vec; time: number };

const stumpffC = (z: number) =>
  z > 1e-8
    ? (1 - Math.cos(Math.sqrt(z))) / z
    : z < -1e-8
      ? (Math.cosh(Math.sqrt(-z)) - 1) / -z
      : 1 / 2 - z / 24 + (z * z) / 720;
const stumpffS = (z: number) => {
  if (z > 1e-8) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-8) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
};

/**
 * Two-body propagation by universal variables (ellipse, parabola, hyperbola, and the
 * radial fall). r0/v0 are relative to the body; returns the relative state after dt.
 */
export function propagate(mu: number, r0: Vec, v0: Vec, dt: number): { r: Vec; v: Vec } {
  if (Math.abs(dt) < 1e-12) return { r: r0, v: v0 };
  const r0n = length(r0),
    sqrtMu = Math.sqrt(mu),
    vr0 = dot(r0, v0) / r0n,
    alpha = 2 / r0n - dot(v0, v0) / mu;
  const k1 = (r0n * vr0) / sqrtMu,
    k2 = 1 - alpha * r0n;
  const F = (x: number) => {
    const z = alpha * x * x;
    return k1 * x * x * stumpffC(z) + k2 * x * x * x * stumpffS(z) + r0n * x - sqrtMu * dt;
  };
  const dF = (x: number) => {
    const z = alpha * x * x;
    return k1 * x * (1 - z * stumpffS(z)) + k2 * x * x * stumpffC(z) + r0n;
  };
  // F rises with x (dF is the distance r > 0), so bracket the root and refine with
  // Newton steps kept inside the bracket. Plain iteration diverges on steep hyperbolas.
  const sign = dt >= 0 ? 1 : -1;
  const over = (x: number) => {
    const f = F(x);
    return Number.isNaN(f) ? sign > 0 : f > 0;
  };
  let lo = 0,
    hi = (sqrtMu * dt) / r0n || sign * 1e-9;
  for (let i = 0; i < 200 && over(hi) !== sign > 0; i++) {
    lo = hi;
    hi *= 2;
  }
  if (sign < 0) [lo, hi] = [hi, lo];
  let x = (lo + hi) / 2;
  for (let i = 0; i < 200; i++) {
    const f = F(x);
    if (Number.isFinite(f)) {
      if (f > 0) hi = x;
      else lo = x;
    } else hi = x;
    const d1 = dF(x);
    let next = Number.isFinite(f) && d1 > 0 ? x - f / d1 : NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - x) < 1e-13 * Math.max(1, Math.abs(x)) || hi - lo < 1e-15) {
      x = next;
      break;
    }
    x = next;
  }
  const z = alpha * x * x,
    C = stumpffC(z),
    S = stumpffS(z);
  const f = 1 - ((x * x) / r0n) * C,
    g = dt - (x * x * x * S) / sqrtMu;
  const r = add(scale(r0, f), scale(v0, g));
  const rn = length(r);
  const fdot = (sqrtMu / (rn * r0n)) * (alpha * x * x * x * S - x),
    gdot = 1 - ((x * x) / rn) * C;
  return { r, v: add(scale(r0, fdot), scale(v0, gdot)) };
}

/**
 * The calculator's path from a state: the two-body conic around the body pulling
 * hardest, re-based on a new body whenever another one starts pulling harder
 * (patched conics). Each moment still uses one body's gravity only. Ends where it
 * meets the current body's surface or at `until`.
 */
export function twoBodyPath(stage: Stage, from: AimState, until = from.time + 600) {
  const first = dominantBody(stage, from.position, from.time);
  if (!first || !(first.mu > 0)) return undefined;
  type Segment = { body: Body; t0: number; r0: Vec; v0: Vec };
  const segments: Segment[] = [];
  const begin = (body: Body, time: number, position: Vec, velocity: Vec) =>
    segments.push({
      body,
      t0: time,
      r0: sub(position, bodyPosition(stage, body, time)),
      v0: sub(velocity, bodyVelocity(stage, body, time)),
    });
  begin(first, from.time, from.position, from.velocity);
  const local = (seg: Segment, time: number) => {
    const s = propagate(seg.body.mu, seg.r0, seg.v0, time - seg.t0);
    return {
      position: add(bodyPosition(stage, seg.body, time), s.r),
      velocity: add(bodyVelocity(stage, seg.body, time), s.v),
      height: length(s.r) - seg.body.radius,
    };
  };
  // Walk forward once to find the hand-overs and the surface contact.
  const steps = 1200,
    dt = Math.max(1e-3, (until - from.time) / steps);
  let end = until,
    impactBody: Body | undefined;
  for (let t = from.time + dt; t <= until + 1e-9; t += dt) {
    const seg = segments.at(-1)!;
    const s = local(seg, t);
    if (s.height < 0) {
      // Bisect the contact moment.
      let a = t - dt,
        b = t;
      for (let i = 0; i < 40; i++) {
        const m = (a + b) / 2;
        if (local(seg, m).height < 0) b = m;
        else a = m;
      }
      end = b;
      impactBody = seg.body;
      break;
    }
    const next = dominantBody(stage, s.position, t);
    if (next && next.id !== seg.body.id && next.mu > 0) begin(next, t, s.position, s.velocity);
  }
  const at = (time: number) => {
    const t = Math.min(Math.max(time, from.time), end);
    let seg = segments[0];
    for (const s of segments) if (s.t0 <= t + 1e-12) seg = s;
    return { ...local(seg, t), body: seg.body };
  };
  return { body: first, end, impactBody, at };
}

export type AimTarget =
  | { kind: 'object'; id: string; name: string; radius: number; object: WorldObject }
  | { kind: 'body'; id: string; name: string; radius: number; body: Body };

/** Targets the mission's goals measure against, except broad regions (altitude bands). */
export function aimTargets(stage: Stage): AimTarget[] {
  const ids = new Set<string>();
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (typeof o.targetId === 'string' && o.targetId) ids.add(o.targetId);
    Object.values(o).forEach(walk);
  };
  stage.goals.forEach((g) => walk(g.condition));
  const out: AimTarget[] = [];
  for (const o of stage.objects)
    if (ids.has(o.id) && o.kind !== 'path' && o.kind !== 'hazard')
      out.push({ kind: 'object', id: o.id, name: o.name, radius: o.radius, object: o });
  for (const b of stage.bodies)
    if (ids.has(b.id) && b.kind !== 'barycenter')
      out.push({ kind: 'body', id: b.id, name: b.name, radius: b.radius, body: b });
  return out;
}

export type Approach = {
  target: AimTarget;
  /** Seconds (absolute mission time) of the closest point. */
  time: number;
  /** Distance between centres. */
  distance: number;
  /** Bodies: the path meets the surface (a landing or an impact). Objects: passes inside. */
  inside: boolean;
  /** Speed relative to the target at that moment. */
  relativeSpeed: number;
  /** Miss direction in the orbit frame of the craft's reference body at that point. */
  outward: number;
  ahead: number;
  /** The path met another body's surface (the calculation ends there). */
  impact?: number;
  /** Closest at the very start: the path only moves away from the target. */
  atStart: boolean;
  /** Still closing in when the calculation window ends. */
  atEnd: boolean;
};

function targetState(stage: Stage, t: AimTarget, time: number) {
  if (t.kind === 'body')
    return {
      position: bodyPosition(stage, t.body, time),
      velocity: bodyVelocity(stage, t.body, time),
    };
  const p = objectPosition(stage, t.object, time),
    q = objectPosition(stage, t.object, time + 1e-3);
  return { position: p, velocity: scale(sub(q, p), 1e3) };
}

/**
 * Closest approach of the two-body path to a target between `from.time` and `until`.
 * A body target is reached when the path touches its surface; the path itself stops
 * where it meets its own reference body's surface.
 */
export function closestApproach(
  stage: Stage,
  from: AimState,
  target: AimTarget,
  until: number,
): Approach | undefined {
  if (until <= from.time) return undefined;
  const path = twoBodyPath(stage, from, until);
  if (!path) return undefined;
  const end = path.end;
  const gap = (time: number) => {
    const c = path.at(time),
      t = targetState(stage, target, time);
    return { c, t, d: length(sub(c.position, t.position)) };
  };
  const reach = (d: number) => target.kind === 'body' && d <= target.radius + 1e-9;
  const samples = 600,
    h = (end - from.time) / samples;
  let best = { time: from.time, d: Infinity },
    contact: number | undefined;
  for (let i = 0; i <= samples; i++) {
    const time = from.time + h * i,
      d = gap(time).d;
    if (d < best.d) best = { time, d };
    if (reach(d)) {
      contact = time;
      break;
    }
  }
  let a = Math.max(from.time, best.time - h),
    b = Math.min(end, best.time + h);
  if (contact !== undefined) {
    // First contact with a body target's surface.
    b = contact;
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (reach(gap(m).d)) b = m;
      else a = m;
    }
    a = b;
  } else
    for (let i = 0; i < 40; i++) {
      const m1 = b - (b - a) / 1.618034,
        m2 = a + (b - a) / 1.618034;
      if (gap(m1).d < gap(m2).d) b = m2;
      else a = m1;
    }
  const time = (a + b) / 2,
    g = gap(time);
  // The path ending on the target body's own surface is reaching it.
  const landedOn =
    path.impactBody && target.kind === 'body' && path.impactBody.id === target.body.id;
  const offset = sub(g.c.position, g.t.position);
  const centre = bodyPosition(stage, g.c.body, time);
  const radial = sub(g.t.position, centre);
  const out = scale(radial, 1 / Math.max(length(radial), 1e-12));
  const along = sub(g.c.velocity, bodyVelocity(stage, g.c.body, time));
  const fwd = scale(along, 1 / Math.max(length(along), 1e-12));
  return {
    target,
    time,
    distance: g.d,
    inside: g.d <= target.radius + 1e-9 || !!(landedOn && Math.abs(time - end) < 1e-6),
    relativeSpeed: length(sub(g.c.velocity, g.t.velocity)),
    outward: dot(offset, out),
    ahead: dot(offset, fwd),
    impact: path.impactBody && !landedOn ? end : undefined,
    // Closest in the first hundredth of the window without touching: only moving away.
    atStart:
      !(g.d <= target.radius + 1e-9) && time - from.time < 0.01 * Math.max(1, until - from.time),
    atEnd: end - time < 1e-3 * Math.max(1, until - from.time) && !path.impactBody,
  };
}

/** What a player reads about one approach: the target, the number, and the detail. */
export function approachParts(a: Approach) {
  const t = `${a.time.toFixed(1)}초`;
  const name = a.target.name;
  if (a.target.kind === 'body') {
    if (a.inside)
      return {
        name,
        value: '표면에 닿음',
        detail: `${t} · 상대속력 ${a.relativeSpeed.toFixed(3)} u/s`,
        hit: true,
      };
    if (a.atStart)
      return { name, value: '멀어지는 중', detail: '이 경로로는 가까워지지 않습니다', hit: false };
    return {
      name,
      value: `표면까지 ${(a.distance - a.target.radius).toFixed(3)} u`,
      detail: `${a.atEnd ? '계산 끝까지 접근 중' : side(a)} · ${t}`,
      hit: false,
    };
  }
  if (a.inside)
    return { name, value: '통과', detail: `중심에서 ${a.distance.toFixed(3)} u · ${t}`, hit: true };
  if (a.atStart)
    return { name, value: '멀어지는 중', detail: '이 경로로는 가까워지지 않습니다', hit: false };
  return {
    name,
    value: `중심까지 ${a.distance.toFixed(3)} u`,
    detail: `${a.atEnd ? '계산 끝까지 접근 중' : side(a)} · 반지름 ${a.target.radius.toFixed(2)} · ${t}`,
    hit: false,
  };
}
/** One line: "외곽 항로 · 중심까지 0.210 u · 바깥쪽으로 빗나감 · …". */
export function approachText(a: Approach) {
  const p = approachParts(a);
  return `${p.name} · ${p.value} · ${p.detail}`;
}
function side(a: Approach) {
  return Math.abs(a.outward) >= Math.abs(a.ahead)
    ? a.outward > 0
      ? '바깥쪽으로 빗나감'
      : '안쪽으로 빗나감'
    : a.ahead > 0
      ? '앞쪽으로 빗나감'
      : '뒤쪽으로 빗나감';
}
