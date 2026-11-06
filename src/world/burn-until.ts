/* "Burn until the orbit is right": a burn or push whose size is set by the orbit it
 * should leave behind (an apoapsis or periapsis height above the body pulling hardest),
 * not by a guessed Δv. The size is read from the craft's own state at the moment it
 * acts, with the one-body Kepler orbit the calculator already shows, so errors made
 * earlier in the flight are absorbed instead of carried forward. `dv` stays a ceiling. */
import { conicOf } from './conic';
import { add, scale, type Vec } from '../physics/vector';
import type { Stage } from './types';

export type BurnUntil = { apsis: 'apoapsis' | 'periapsis'; height: number };

function apsisHeight(stage: Stage, p: Vec, v: Vec, t: number, apsis: BurnUntil['apsis']) {
  const c = conicOf(stage, p, v, t);
  if (!c) return undefined;
  const r = apsis === 'apoapsis' ? (c.bound ? c.apoapsis : Infinity) : c.periapsis;
  return r - c.body.radius;
}

/**
 * Speed change along `direction` (0..cap) that brings the apsis to the set height:
 * the first crossing from where it is now. Already there or past it: 0. Out of reach
 * within the ceiling: the ceiling when it gets closer, else nothing.
 */
export function untilDv(
  stage: Stage,
  position: Vec,
  velocity: Vec,
  time: number,
  direction: Vec,
  until: BurnUntil,
  cap: number,
) {
  const g = (x: number) => {
    const h = apsisHeight(stage, position, add(velocity, scale(direction, x)), time, until.apsis);
    return h === undefined ? NaN : h - until.height;
  };
  const g0 = g(0);
  if (!Number.isFinite(g0) && !(g0 === Infinity)) return cap;
  if (Math.abs(g0) < 1e-6) return 0;
  const side = Math.sign(g0);
  const n = 48;
  let lo = 0;
  for (let i = 1; i <= n; i++) {
    const x = (cap * i) / n;
    const gx = g(x);
    if (Number.isFinite(gx) ? Math.sign(gx) !== side : side < 0 && gx === Infinity) {
      let a = lo,
        b = x;
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2;
        const gm = g(m);
        if (Number.isFinite(gm) ? Math.sign(gm) === side : side > 0) a = m;
        else b = m;
      }
      return (a + b) / 2;
    }
    lo = x;
  }
  // Out of reach: the ceiling if it at least gets closer, nothing if this way leads away.
  const end = g(cap);
  return Number.isFinite(end) && Math.abs(end) < Math.abs(g0) ? cap : 0;
}
