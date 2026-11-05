import { describe, expect, it } from 'vitest';
import { conicAround, conicPath, conicPoint, bodyFacts } from '../src/world/conic';
import type { Body } from '../src/world/types';

const planet = {
  id: 'p',
  name: 'P',
  kind: 'planet',
  position: { x: 0, y: 0 },
  radius: 1,
  mu: 1,
} as Body;
const at = (p: { x: number; y: number }, v: { x: number; y: number }) =>
  conicAround(planet, { x: 0, y: 0 }, { x: 0, y: 0 }, p, v);

describe('two-body orbit calculator', () => {
  it('reads a circular orbit', () => {
    const c = at({ x: 2, y: 0 }, { x: 0, y: Math.sqrt(0.5) });
    expect(c.e).toBeLessThan(1e-9);
    expect(c.periapsis).toBeCloseTo(2, 9);
    expect(c.apoapsis).toBeCloseTo(2, 9);
    expect(c.period).toBeCloseTo(2 * Math.PI * Math.sqrt(8), 6);
    expect(c.impactNu).toBeUndefined();
  });
  it('finds periapsis and apoapsis of an ellipse in either direction', () => {
    for (const sign of [1, -1]) {
      const c = at({ x: 2, y: 0 }, { x: 0, y: sign * 0.6 });
      expect(c.bound).toBe(true);
      expect(c.apoapsis).toBeCloseTo(2, 9);
      // vis-viva: a = 1/(2/r − v²)
      expect(c.periapsis + c.apoapsis).toBeCloseTo(2 / (2 / 2 - 0.36), 9);
      const p = conicPoint(c, c.nu);
      expect(p.x).toBeCloseTo(2, 9);
      expect(p.y).toBeCloseTo(0, 9);
    }
  });
  it('reports escape and the surface crossing ahead', () => {
    expect(at({ x: 2, y: 0 }, { x: 0, y: 1.2 }).bound).toBe(false);
    const fall = at({ x: 2, y: 0 }, { x: 0, y: 0.3 });
    expect(fall.impactNu).toBeDefined();
    const hit = conicPoint(fall, fall.impactNu!);
    expect(Math.hypot(hit.x, hit.y)).toBeCloseTo(1, 9);
    const path = conicPath(fall, 10);
    expect(Math.hypot(path.at(-1)!.x, path.at(-1)!.y)).toBeCloseTo(1, 6);
    // The path leaves the craft going the way it moves (counter-clockwise here).
    expect(path[3].y).toBeGreaterThan(0);
  });
  it('derives body facts from mu and radius', () => {
    const f = bodyFacts(planet);
    expect(f.surfaceGravity).toBe(1);
    expect(f.escapeSpeed).toBeCloseTo(Math.SQRT2, 12);
    expect(f.orbitSpeedAt(1)).toBeCloseTo(Math.sqrt(0.5), 12);
  });
});
describe('straight up-and-down flight', () => {
  it('reads the top of the hop and a fall', () => {
    const c = at({ x: 1.2, y: 0 }, { x: 0.3, y: 0 });
    // energy = 0.045 − 1/1.2; a = −1/(2E); apex r = 2a for a radial path
    const E = 0.045 - 1 / 1.2;
    expect(c.apoapsis).toBeCloseTo(-1 / E, 9);
    expect(c.impactNu).toBeDefined();
  });
});
